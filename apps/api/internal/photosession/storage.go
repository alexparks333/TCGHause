package photosession

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
)

// bucket matches apps/web/lib/storage.ts's BUCKET — phone-uploaded photos
// land in the exact same bucket, under the exact same {user_id}/... prefix,
// as a desktop upload. That's deliberate: it means the seller can later
// delete a phone-uploaded photo through the completely unchanged,
// already-existing authenticated deleteListingPhoto() flow, since the
// existing delete RLS policy already scopes to their own folder.
const bucket = "listing-photos"

// uploadToSupabaseStorage is the first server-side (as opposed to
// browser-direct) Supabase Storage write in this codebase — necessary
// because the phone in this flow is never logged in, so it can't satisfy the
// existing auth.uid()-based RLS policy the browser upload path relies on.
// Plain net/http rather than a new SDK dependency, matching this repo's
// minimal-dependency style (stdlib mux, plain pgx, no ORM).
func uploadToSupabaseStorage(ctx context.Context, supabaseURL, serviceRoleKey, path string, data []byte, contentType string) (publicURL string, err error) {
	uploadURL := fmt.Sprintf("%s/storage/v1/object/%s/%s", supabaseURL, bucket, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, uploadURL, bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("build storage upload request: %w", err)
	}
	// Supabase's Storage API requires both headers set to the service-role
	// key for a privileged, RLS-bypassing write — apikey identifies the
	// project, Authorization is what actually grants the write.
	req.Header.Set("apikey", serviceRoleKey)
	req.Header.Set("Authorization", "Bearer "+serviceRoleKey)
	req.Header.Set("Content-Type", contentType)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("upload to storage: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("storage upload failed: %s: %s", resp.Status, string(body))
	}

	return fmt.Sprintf("%s/storage/v1/object/public/%s/%s", supabaseURL, bucket, path), nil
}

// extensionForContentType matches the three types apps/web/lib/storage.ts
// (ALLOWED_TYPES) and this package's http.go both validate against.
func extensionForContentType(contentType string) (string, bool) {
	switch contentType {
	case "image/jpeg":
		return "jpg", true
	case "image/png":
		return "png", true
	case "image/webp":
		return "webp", true
	default:
		return "", false
	}
}
