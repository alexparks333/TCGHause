"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Upload, X, Loader2 } from "lucide-react";
import { uploadListingPhoto, deleteListingPhoto } from "@/lib/storage";
import PhotoCropModal from "./PhotoCropModal";

export default function PhotoSlot({
  label,
  hint,
  url,
  onUploaded,
  onRemoved,
}: {
  label: string;
  hint: string;
  url: string | null;
  onUploaded: (url: string) => void;
  onRemoved: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [cropSrc, setCropSrc] = useState<{ src: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File | undefined) {
    if (!file) return;
    setError("");
    // Crop first — the uploaded file is whatever the crop step produces,
    // never the raw picked file (see PhotoCropModal.tsx for why: it's what
    // guarantees every listing photo is framed the same regardless of the
    // source photo's own aspect ratio).
    setCropSrc({ src: URL.createObjectURL(file), name: file.name });
  }

  async function handleCropConfirm(croppedFile: File) {
    const objectUrl = cropSrc?.src;
    setCropSrc(null);
    if (objectUrl) URL.revokeObjectURL(objectUrl);

    setUploading(true);
    try {
      const uploadedUrl = await uploadListingPhoto(croppedFile);
      onUploaded(uploadedUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function handleCropCancel() {
    if (cropSrc) URL.revokeObjectURL(cropSrc.src);
    setCropSrc(null);
  }

  async function handleRemove() {
    const previous = url;
    onRemoved();
    if (previous) await deleteListingPhoto(previous);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium text-gray-700">{label}</p>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFile(e.dataTransfer.files?.[0]);
        }}
        onClick={() => !url && !uploading && inputRef.current?.click()}
        className={`relative flex aspect-[4/5] flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border-2 border-dashed transition-colors ${
          url
            ? "border-gray-300"
            : "cursor-pointer border-gray-300 hover:border-brand-navy hover:bg-brand-surface"
        }`}
      >
        {url ? (
          <>
            <Image src={url} alt={label} fill className="object-cover" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleRemove();
              }}
              aria-label={`Remove ${label}`}
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 shadow-sm transition-colors hover:bg-white"
            >
              <X size={14} />
            </button>
          </>
        ) : uploading ? (
          <Loader2 size={22} className="animate-spin text-gray-400" />
        ) : (
          <>
            <Upload size={20} className="text-gray-400" />
            <p className="px-3 text-center text-xs text-gray-400">{hint}</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
      {error && <p className="text-xs text-brand-urgent">{error}</p>}

      {cropSrc && (
        <PhotoCropModal
          imageSrc={cropSrc.src}
          fileName={cropSrc.name}
          onCancel={handleCropCancel}
          onConfirm={handleCropConfirm}
        />
      )}
    </div>
  );
}
