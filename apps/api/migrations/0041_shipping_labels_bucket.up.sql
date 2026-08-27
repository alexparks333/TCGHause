-- Pitney Bowes returns label artwork as base64-encoded PDF data inline in
-- the API response, not a hosted URL the way Shippo's labels are — the
-- rest of this codebase (the download-proxy endpoint, PrintLabelButton's
-- "Download PDF") assumes label_url is always a fetchable URL, so
-- internal/shipping decodes that data and uploads it here immediately,
-- keeping every other vendor-agnostic. Public bucket, same posture as
-- listing-photos (0004): the actual access control is our own auth layer
-- on the endpoints that hand out these URLs, not bucket-level RLS, and
-- the object path (an unguessable order/shipment id) isn't discoverable
-- by browsing. Only ever written by the Go API directly via the
-- service-role key (no browser upload path exists for this bucket at
-- all), so no insert/delete RLS policy is needed the way listing-photos
-- needed one for direct browser uploads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'shipping-labels', 'shipping-labels', true,
    5242880, -- 5MB, generous for a one-page label PDF
    array['application/pdf']
);
