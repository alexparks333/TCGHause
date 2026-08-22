import { supabase } from './supabase';

// Mirrors apps/web/lib/storage.ts's uploadOrderEvidence exactly in intent
// (straight to Supabase Storage, no Go backend involved — record the
// resulting URL via lib/api.ts's addOrderEvidence/addClaimEvidence right
// after), adapted for React Native: there's no File object here, just a
// local file:// URI from expo-image-picker, and no expo-file-system
// dependency in this app — fetch(uri).arrayBuffer() reads the local file
// into memory without adding one, which is enough for a handful of order
// photos.
const EVIDENCE_BUCKET = 'order-evidence';
const MAX_BYTES = 10 * 1024 * 1024; // matches the bucket's file_size_limit

function extAndContentType(uri: string): { ext: string; contentType: string } {
  const ext = (uri.split('.').pop() || 'jpg').toLowerCase().split('?')[0];
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return { ext, contentType };
}

// path is scoped to the order's own folder ({order_id}/...), same RLS
// policy (migration 0024_evidence) as the web upload — checks the
// uploader is actually a participant (buyer or seller) in that order.
export async function uploadOrderEvidence(orderId: string, uri: string): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('You must be signed in to upload photos.');
  }

  const response = await fetch(uri);
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_BYTES) {
    throw new Error('Photos must be under 10MB.');
  }

  const { ext, contentType } = extAndContentType(uri);
  const path = `${orderId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, arrayBuffer, {
    cacheControl: '3600',
    upsert: false,
    contentType,
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(EVIDENCE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
