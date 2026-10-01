package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestProviderGatewayFailureDiagnosticKeepsErrorAndModelNames(t *testing.T) {
	gin.SetMode(gin.TestMode)
	m := &manifest{ModelIDs: []string{"gpt-5.6-terra"}, apiKeyByValue: map[string]*apiKeySpec{
		"client-key": {ID: "key", Key: "client-key", Enabled: true},
	}}
	policy := &requestPolicy{manifest: m, emitter: &eventEmitter{}}
	router := gin.New()
	router.Use(policy.middleware())
	router.POST("/v1/responses", func(c *gin.Context) {
		c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), requestUpstreamModelContextKey, "glm-5.3"))
		writeAPIError(c, http.StatusBadGateway, "Post upstream: EOF", "bad_gateway")
	})
	out := captureStdout(t, func() {
		req := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(`{"model":"gpt-5.6-terra"}`))
		req.Header.Set("Authorization", "Bearer client-key")
		router.ServeHTTP(httptest.NewRecorder(), req)
	})
	var completed requestDiagnosticPayload
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		var event requestDiagnosticPayload
		if json.Unmarshal([]byte(line), &event) == nil && event.Type == "request_completed" {
			completed = event
		}
	}
	if completed.Status != http.StatusBadGateway || !strings.Contains(completed.ErrorMessage, "EOF") {
		t.Fatalf("failure detail was lost: %#v", completed)
	}
	if completed.RequestedModel != "gpt-5.6-terra" || completed.UpstreamModel != "glm-5.3" {
		t.Fatalf("model names were conflated: %#v", completed)
	}
}

func TestProviderGatewayFailureWithoutUsageKeepsMappedModel(t *testing.T) {
	payload, ok := newRequestUsageTracker().finalize("failure", usageFinalizeInput{
		model: "gpt-5.6-terra", upstreamModel: "glm-5.3", status: http.StatusBadGateway,
		errorMessage: "Post upstream: EOF", completedAtMS: 123,
	})
	if !ok || payload.Success || payload.RequestedModel != "gpt-5.6-terra" || payload.UpstreamModel != "glm-5.3" || payload.Model != "glm-5.3" {
		t.Fatalf("fallback usage did not retain the route: %#v", payload)
	}
	if !strings.Contains(payload.ErrorMessage, "EOF") {
		t.Fatalf("fallback usage lost the error: %#v", payload)
	}
}
