//! 受管模型目录（`cockpit-model-catalog.json`）的生成版本戳。
//!
//! 目录内容由代码生成，却会长期留在用户 profile 里：升级应用后如果只改了生成
//! 逻辑而不重建文件，客户端会继续读旧内容（例如 Grok 模型缺少多智能体能力声明）。
//! 这里在同目录写一个 meta 文件，记录生成器版本与目录内容哈希；启动时比对即可
//! 判断是否需要重建，既不依赖切号，也不必每次启动都重新生成。

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

/// 受管模型目录生成逻辑的版本号。改动目录结构或模型能力字段时递增。
///
/// 3：上下文与压缩统一为 90% 口径（压缩阈值不再留空），GPT-6 系列上下文修正为 256K。
/// 4：加入 GPT-6.1 Sol 客户端目录。
/// 5：删除退役型号的内置模板与兼容槽位。
/// 6：按目录所属 API Key 重建，保留有效上下文与默认模型。
// 7: stable model identities and one writer for all managed catalog lifecycles.
pub(crate) const MANAGED_MODEL_CATALOG_GENERATOR_VERSION: u32 = 7;

static MANAGED_CATALOG_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

const META_FILE_NAME: &str = "cockpit-model-catalog.meta.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ManagedModelCatalogMeta {
    generator: u32,
    #[serde(rename = "appVersion")]
    app_version: String,
    #[serde(rename = "catalogHash")]
    catalog_hash: String,
    #[serde(rename = "writtenAt")]
    written_at_ms: i64,
    #[serde(default, rename = "gatewayAccountId", skip_serializing_if = "Option::is_none")]
    gateway_account_id: Option<String>,
}

pub(crate) fn managed_catalog_meta_path(catalog_path: &Path) -> PathBuf {
    catalog_path.with_file_name(META_FILE_NAME)
}

fn managed_catalog_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// catalog 写入成功后刷新版本戳；失败只影响版本判断，不影响目录本身。
pub(crate) fn write_managed_catalog_meta(catalog_path: &Path) -> Result<(), String> {
    write_managed_catalog_meta_for_gateway(catalog_path, None)
}

pub(crate) fn managed_catalog_gateway_account_id(catalog_path: &Path) -> Option<String> {
    if !catalog_path.is_file() { return None; }
    let catalog = fs::read_to_string(catalog_path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&catalog).ok()?;
    if let Some(owner) = parsed.get("cockpit_account_id") {
        return owner.as_str().filter(|id| !id.trim().is_empty()).map(str::to_string);
    }
    let content = fs::read_to_string(managed_catalog_meta_path(catalog_path)).ok()?;
    let meta = serde_json::from_str::<ManagedModelCatalogMeta>(&content).ok()?;
    if meta.catalog_hash != managed_catalog_hash(&catalog) { return None; }
    meta.gateway_account_id.filter(|id| !id.trim().is_empty())
}

/// Only Cockpit's owned catalog is writable here; user catalogs are never updated.
pub(crate) fn write_managed_model_catalog(
    catalog_path: &Path,
    content: &str,
    account_id: Option<&str>,
) -> Result<bool, String> {
    if catalog_path.file_name().and_then(|name| name.to_str()) != Some("cockpit-model-catalog.json") {
        return Err(format!("Refusing to overwrite a user model catalog: {}", catalog_path.display()));
    }
    let profile_dir = catalog_path.parent().ok_or("Model catalog has no profile directory")?;
    let _guard = MANAGED_CATALOG_WRITE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let mut parsed: serde_json::Value = serde_json::from_str(content)
        .map_err(|error| format!("Invalid managed model catalog: {}", error))?;
    if parsed.get("models").and_then(serde_json::Value::as_array).is_none() {
        return Err("Managed model catalog has no models array".into());
    }
    // Store ownership with the catalog itself, so a crash between catalog and meta
    // writes cannot assign the new Key's models to the previous Key.
    parsed["cockpit_account_id"] = account_id.map_or(serde_json::Value::Null, |id| id.into());
    for model in parsed["models"].as_array_mut().expect("validated models array") {
        model["cockpit_account_id"] = account_id.map_or(serde_json::Value::Null, |id| id.into());
    }
    let serialized = serde_json::to_string_pretty(&parsed).map_err(|error| error.to_string())?;
    let content = crate::modules::codex_local_access::retain_previous_provider_catalog_models(
        profile_dir, serialized,
    );
    let changed = fs::read_to_string(catalog_path).ok().as_deref() != Some(content.as_str());
    if changed {
        crate::modules::atomic_write::write_string_atomic(catalog_path, &content)?;
    }
    write_managed_catalog_meta_for_gateway(catalog_path, account_id)?;
    Ok(changed)
}

pub(crate) fn write_managed_catalog_meta_for_gateway(
    catalog_path: &Path,
    account_id: Option<&str>,
) -> Result<(), String> {
    let content = fs::read_to_string(catalog_path).map_err(|e| {
        format!(
            "读取模型目录以写入版本戳失败: path={}, error={}",
            catalog_path.display(),
            e
        )
    })?;
    let meta = ManagedModelCatalogMeta {
        generator: MANAGED_MODEL_CATALOG_GENERATOR_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        catalog_hash: managed_catalog_hash(&content),
        written_at_ms: chrono::Utc::now().timestamp_millis(),
        gateway_account_id: account_id.map(str::to_string),
    };
    if let Ok(existing) = fs::read_to_string(managed_catalog_meta_path(catalog_path)) {
        if let Ok(previous) = serde_json::from_str::<ManagedModelCatalogMeta>(&existing) {
            if previous.generator == meta.generator
                && previous.app_version == meta.app_version
                && previous.catalog_hash == meta.catalog_hash
                && previous.gateway_account_id == meta.gateway_account_id
            {
                return Ok(());
            }
        }
    }
    let serialized = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("序列化模型目录版本戳失败: {}", e))?;
    crate::modules::atomic_write::write_string_atomic(
        &managed_catalog_meta_path(catalog_path),
        &serialized,
    )
}

/// catalog 被删除时同步清理版本戳，避免留下孤儿 meta。
pub(crate) fn remove_managed_catalog_meta(catalog_path: &Path) {
    let path = managed_catalog_meta_path(catalog_path);
    if path.exists() {
        let _ = fs::remove_file(path);
    }
}

/// 判断受管模型目录是否落后于当前生成逻辑。
///
/// - 目录文件不存在：返回 false（没有受管目录，无需重建）
/// - 版本戳缺失 / 内容哈希不匹配 / 生成器版本落后：返回 true
pub(crate) fn managed_catalog_needs_rebuild(catalog_path: &Path) -> bool {
    if !catalog_path.exists() {
        return false;
    }
    let Ok(content) = fs::read_to_string(catalog_path) else {
        return false;
    };
    let Ok(serialized) = fs::read_to_string(managed_catalog_meta_path(catalog_path)) else {
        return true;
    };
    let Ok(meta) = serde_json::from_str::<ManagedModelCatalogMeta>(&serialized) else {
        return true;
    };
    meta.generator != MANAGED_MODEL_CATALOG_GENERATOR_VERSION
        || meta.catalog_hash != managed_catalog_hash(&content)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().expect("parent")).expect("create dir");
        fs::write(path, content).expect("write");
    }

    #[test]
    fn missing_catalog_never_needs_rebuild() {
        let dir = std::env::temp_dir().join(format!("catalog-meta-a-{}", std::process::id()));
        let catalog = dir.join("cockpit-model-catalog.json");
        let _ = fs::remove_dir_all(&dir);
        assert!(!managed_catalog_needs_rebuild(&catalog));
    }

    #[test]
    fn catalog_without_meta_needs_rebuild_until_stamped() {
        let dir = std::env::temp_dir().join(format!("catalog-meta-b-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let catalog = dir.join("cockpit-model-catalog.json");
        write(&catalog, "{\"models\":[]}");
        assert!(managed_catalog_needs_rebuild(&catalog));
        write_managed_catalog_meta(&catalog).expect("write meta");
        assert!(!managed_catalog_needs_rebuild(&catalog));
        // 内容被外部改写后哈希不再匹配，需要重建。
        write(&catalog, "{\"models\":[{\"slug\":\"grok-4.6\"}]}");
        assert!(managed_catalog_needs_rebuild(&catalog));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn catalog_config_reconcile_does_not_rotate_unchanged_backup() {
        let dir = std::env::temp_dir().join(format!("catalog-config-{}-{}", std::process::id(), chrono::Utc::now().timestamp_micros()));
        fs::create_dir_all(&dir).unwrap();
        let config = dir.join("config.toml");
        crate::modules::codex_config_format::write_codex_config_toml_atomic(&config, "model = \"kimi-k3-1\"\n").unwrap();
        let next = "model = \"glm-5.3\"\n";
        crate::modules::codex_config_format::write_codex_config_toml_atomic(&config, next).unwrap();
        let backup = fs::read(config.with_extension("toml.bak")).unwrap();
        crate::modules::codex_config_format::write_codex_config_toml_atomic(&config, next).unwrap();
        assert_eq!(fs::read(config.with_extension("toml.bak")).unwrap(), backup);
        assert_eq!(fs::read_to_string(config).unwrap(), next);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn managed_catalog_switches_preserve_identity_without_extra_files_or_writes() {
        let dir = std::env::temp_dir().join(format!("catalog-lifecycle-{}-{}", std::process::id(), chrono::Utc::now().timestamp_micros()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cockpit-model-catalog.json");
        let user_path = dir.join("user-models.json");
        write(&user_path, "user-owned sentinel");
        let first = serde_json::json!({"models": [
            {"slug": "kimi-k3-1", "display_name": "Kimi K3", "visibility": "list", "context_window": 300000, "auto_compact_token_limit": 276000},
            {"slug": "glm-5.3", "display_name": "GLM 5.3", "visibility": "list", "context_window": 256000, "auto_compact_token_limit": 230000},
            {"slug": "vendor/model-v9", "display_name": "My Vendor Model", "visibility": "list", "context_window": 128000, "auto_compact_token_limit": 110000}
        ]});
        let second = serde_json::json!({"models": [
            {"slug": "gpt-6.1-sol", "display_name": "GPT-6.1 Sol", "visibility": "list", "context_window": 300000, "auto_compact_token_limit": 276000}
        ]});
        let complete_catalog = |source: &serde_json::Value| {
            let ids = source["models"].as_array().unwrap().iter()
                .map(|model| model["slug"].as_str().unwrap().to_string()).collect::<Vec<_>>();
            let mut catalog = crate::modules::codex_protocol::build_codex_client_models_response(&ids);
            for model in catalog["models"].as_array_mut().unwrap() {
                if let Some(overrides) = source["models"].as_array().unwrap().iter().find(|item| item["slug"] == model["slug"]) {
                    for (key, value) in overrides.as_object().unwrap() {
                        model[key] = value.clone();
                    }
                }
            }
            catalog
        };
        let first = complete_catalog(&first);
        let second = complete_catalog(&second);
        assert!(write_managed_model_catalog(&path, &first.to_string(), Some("key-third")).unwrap());
        let first_content = fs::read_to_string(&path).unwrap();
        assert!(write_managed_model_catalog(&path, &second.to_string(), Some("key-oai")).unwrap());
        let content = fs::read_to_string(&path).unwrap();
        let meta = fs::read(managed_catalog_meta_path(&path)).unwrap();
        let backup = fs::read(path.with_extension("json.bak")).unwrap();
        let meta_backup = fs::read(managed_catalog_meta_path(&path).with_extension("json.bak")).unwrap();
        let catalog: serde_json::Value = serde_json::from_str(&content).unwrap();
        for source in first["models"].as_array().unwrap() {
            let retained = catalog["models"].as_array().unwrap().iter().find(|item| item["slug"] == source["slug"]).unwrap();
            assert_eq!(retained["display_name"], source["display_name"]);
            assert_eq!(retained["context_window"], source["context_window"]);
            assert_eq!(retained["visibility"], "hide");
        }
        assert_eq!(managed_catalog_gateway_account_id(&path).as_deref(), Some("key-oai"));
        // Repeated reconciliation must not rotate backups or timestamps.
        assert!(!write_managed_model_catalog(&path, &second.to_string(), Some("key-oai")).unwrap());
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
        assert_eq!(fs::read(managed_catalog_meta_path(&path)).unwrap(), meta);
        assert_eq!(fs::read(path.with_extension("json.bak")).unwrap(), backup);
        assert_eq!(fs::read(managed_catalog_meta_path(&path).with_extension("json.bak")).unwrap(), meta_backup);
        assert!(write_managed_model_catalog(&user_path, &first.to_string(), Some("key-third")).is_err());
        assert!(write_managed_model_catalog(&path, "{\"models\":null}", Some("key-third")).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
        assert_eq!(fs::read_to_string(&user_path).unwrap(), "user-owned sentinel");
        // Catalog ownership remains correct even if a stale meta survives a crash.
        write(&managed_catalog_meta_path(&path), "{}");
        assert_eq!(managed_catalog_gateway_account_id(&path).as_deref(), Some("key-oai"));
        assert!(managed_catalog_needs_rebuild(&path));
        assert!(!write_managed_model_catalog(&path, &second.to_string(), Some("key-oai")).unwrap());
        assert!(!managed_catalog_needs_rebuild(&path));
        assert!(write_managed_model_catalog(&path, &first.to_string(), Some("key-third")).unwrap());
        let restored: serde_json::Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        for source in first["models"].as_array().unwrap() {
            let active = restored["models"].as_array().unwrap().iter().find(|item| item["slug"] == source["slug"]).unwrap();
            assert_eq!(active["display_name"], source["display_name"]);
            assert_eq!(active["visibility"], "list");
        }
        // CI consumes the real writer outputs with an isolated Codex app-server.
        if let Ok(output_dir) = std::env::var("COCKPIT_CATALOG_CONTRACT_OUTPUT") {
            let output = PathBuf::from(output_dir);
            fs::create_dir_all(&output).unwrap();
            write(&output.join("key-third.json"), &first_content);
            write(&output.join("key-oai.json"), &content);
            write(&output.join("key-third-restored.json"), &fs::read_to_string(&path).unwrap());
        }
        let mut names = fs::read_dir(&dir).unwrap().map(|entry| entry.unwrap().file_name().into_string().unwrap()).collect::<Vec<_>>();
        names.sort();
        assert_eq!(names, vec!["cockpit-model-catalog.json", "cockpit-model-catalog.json.bak", "cockpit-model-catalog.meta.json", "cockpit-model-catalog.meta.json.bak", "user-models.json"]);
        fs::remove_dir_all(dir).unwrap();
    }

}
