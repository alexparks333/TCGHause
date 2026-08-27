package shipping

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
)

const labelBucket = "shipping-labels"

// uploadLabelPDF decodes base64-encoded PDF bytes (Pitney Bowes returns
// label artwork inline in its API response, not a hosted URL the way
// Shippo's labels are) and uploads them to Supabase Storage so label_url
// stays a plain fetchable URL everywhere else in the codebase — the
// download-proxy endpoint and PrintLabelButton never need to know which
// vendor actually produced a given label. Same server-side-write pattern
// as internal/photosession's phone-upload flow (service-role key,
// RLS-bypassing), the first other write of this shape in this codebase.
func uploadLabelPDF(ctx context.Context, supabaseURL, serviceRoleKey, path, base64Data string) (publicURL string, err error) {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", fmt.Errorf("decode label pdf: %w", err)
	}

	uploadURL := fmt.Sprintf("%s/storage/v1/object/%s/%s", supabaseURL, labelBucket, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, uploadURL, bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("build storage upload request: %w", err)
	}
	req.Header.Set("apikey", serviceRoleKey)
	req.Header.Set("Authorization", "Bearer "+serviceRoleKey)
	req.Header.Set("Content-Type", "application/pdf")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("upload label to storage: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("label storage upload failed: %s: %s", resp.Status, string(body))
	}

	return fmt.Sprintf("%s/storage/v1/object/public/%s/%s", supabaseURL, labelBucket, path), nil
}
