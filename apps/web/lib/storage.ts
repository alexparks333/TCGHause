import { createClient } from "./supabase/client";

const BUCKET = "listing-photos";
const MAX_BYTES = 10 * 1024 * 1024; // matches the bucket's file_size_limit
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Uploads straight to Supabase Storage from the browser — no Go backend
// involved, same pattern as Supabase Auth. Photos are uploaded during the
// Sell wizard's step 2, before the listing itself exists, so they're
// scoped to the uploader's own folder ({user_id}/...), not a listing id —
// see apps/api/migrations/0004_listing_photos.up.sql and CLAUDE.md §6.13.
export async function uploadListingPhoto(file: File): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Photos must be JPEG, PNG, or WebP.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Photos must be under 10MB.");
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("You must be signed in to upload photos.");
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// Best-effort cleanup — if a user removes a photo mid-wizard (before the
// listing is ever created), don't leave it orphaned in storage.
export async function deleteListingPhoto(url: string): Promise<void> {
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return;

  const path = decodeURIComponent(url.slice(idx + marker.length));
  const supabase = createClient();
  await supabase.storage.from(BUCKET).remove([path]);
}
