package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/registry"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/config"
)

func TestManifestTokenRegistrationUsesPreloadedSnapshot(t *testing.T) {
	authDir := t.TempDir()
	path := filepath.Join(authDir, "preloaded-token.json")
	if err := os.WriteFile(path, []byte(`{"type":"codex","access_token":"synthetic-token"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{AuthDir: authDir}
	m := &manifest{Accounts: []accountSpec{{ID: "preloaded-token", AuthID: "preloaded-token.json", AuthKind: "access_token"}}}
	auths, err := loadManifestCodexTokenAuths(cfg, m)
	if err != nil {
		t.Fatal(err)
	}
	// Simulate a concurrent writer after the initial read, before registration.
	if err := os.WriteFile(path, []byte(`{"access_token":`), 0o600); err != nil {
		t.Fatal(err)
	}
	manager := coreauth.NewManager(nil, nil, nil)
	service, err := cliproxy.NewBuilder().WithConfig(cfg).
		WithConfigPath(filepath.Join(authDir, "config.yaml")).WithCoreAuthManager(manager).Build()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { registry.GetGlobalRegistry().UnregisterClient("preloaded-token.json") })
	if err := registerManifestCodexTokenAuths(context.Background(), service, m, manager, auths); err != nil {
		t.Fatalf("register snapshot after file rewrite: %v", err)
	}
	registered, ok := manager.GetByID("preloaded-token.json")
	if !ok || registered.Metadata["access_token"] != "synthetic-token" {
		t.Fatal("registration did not retain the preloaded credential")
	}
	content, err := os.ReadFile(path)
	if err != nil || string(content) != `{"access_token":` {
		t.Fatalf("registration unexpectedly rewrote the auth file: %v", err)
	}
}

func TestSidecarRuntimeRejectsInvalidManifestAuthBeforeStartup(t *testing.T) {
	authDir := t.TempDir()
	path := filepath.Join(authDir, "invalid-token.json")
	if err := os.WriteFile(path, []byte(`{"access_token":`), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{AuthDir: authDir}
	m := &manifest{Accounts: []accountSpec{{ID: "invalid-token", AuthID: "invalid-token.json", AuthKind: "access_token"}}}
	runtime, err := newSidecarRuntime(context.Background(), filepath.Join(authDir, "missing.yaml"), cfg, m, coreauth.NewManager(nil, nil, nil))
	if runtime != nil {
		runtime.Stop()
		t.Fatal("invalid credentials should not start the runtime")
	}
	if err == nil || !strings.Contains(err.Error(), "parse manifest token auth file") {
		t.Fatalf("expected a preflight auth parse error, got %v", err)
	}
}
