// Client for the standalone CardVision service (apps/cardvision) — a
// completely separate app/database/API from the marketplace's own Go
// backend (apps/api). See apps/cardvision's own README/CLAUDE.md notes:
// "photo-matched, not authenticated."
const CARDVISION_URL = process.env.EXPO_PUBLIC_CARDVISION_URL ?? 'http://localhost:8090';

export type CaptureContext = 'listing' | 'delivery' | 'resubmission' | 'manual';

export interface ScanResponse {
  id: string;
  physicalCardId: string | null;
  capturedAt: string;
  captureContext: string;
  uploaderRef: string;
  externalListingRef: string | null;
  imageFrontUrl: string;
  imageBackUrl: string;
  processedFrontUrl: string | null;
  processedBackUrl: string | null;
  qualityTier: string | null;
  qualityDetail: Record<string, unknown> | null;
  status: string;
}

// The Go API uses camelCase JSON; CardVision (Python/Pydantic) uses
// snake_case — this maps that response shape into the same camelCase
// convention the rest of this app's TS code uses.
function fromSnakeCaseScan(raw: any): ScanResponse {
  return {
    id: raw.id,
    physicalCardId: raw.physical_card_id ?? null,
    capturedAt: raw.captured_at,
    captureContext: raw.capture_context,
    uploaderRef: raw.uploader_ref,
    externalListingRef: raw.external_listing_ref ?? null,
    imageFrontUrl: raw.image_front_url,
    imageBackUrl: raw.image_back_url,
    processedFrontUrl: raw.processed_front_url ?? null,
    processedBackUrl: raw.processed_back_url ?? null,
    qualityTier: raw.quality_tier ?? null,
    qualityDetail: raw.quality_detail ?? null,
    status: raw.status,
  };
}

export async function createScan({
  frontUri,
  backUri,
  captureContext,
  uploaderRef,
  externalListingRef,
}: {
  frontUri: string;
  backUri: string;
  captureContext: CaptureContext;
  uploaderRef: string;
  externalListingRef?: string;
}): Promise<ScanResponse> {
  const formData = new FormData();
  formData.append('front', { uri: frontUri, name: 'front.jpg', type: 'image/jpeg' } as unknown as Blob);
  formData.append('back', { uri: backUri, name: 'back.jpg', type: 'image/jpeg' } as unknown as Blob);
  formData.append('capture_context', captureContext);
  formData.append('uploader_ref', uploaderRef);
  if (externalListingRef) formData.append('external_listing_ref', externalListingRef);

  // Deliberately no Content-Type header — fetch sets the multipart
  // boundary itself when the body is a FormData; setting it manually
  // breaks the boundary and the server can't parse the upload at all.
  const res = await fetch(`${CARDVISION_URL}/scans`, { method: 'POST', body: formData });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Scan upload failed: ${res.status}`);
  }
  return fromSnakeCaseScan(await res.json());
}

export async function getScan(id: string): Promise<ScanResponse> {
  const res = await fetch(`${CARDVISION_URL}/scans/${id}`);
  if (!res.ok) throw new Error(`Failed to load scan: ${res.status}`);
  return fromSnakeCaseScan(await res.json());
}
