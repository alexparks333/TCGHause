"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Camera, Check, Loader2 } from "lucide-react";
import { getPhotoUploadSessionStatus, uploadPhotoToSession } from "@/lib/api";

interface UploadedPhoto {
  id: string;
  previewUrl: string;
  uploading: boolean;
  failed: boolean;
}

type SessionState = "checking" | "ready" | "expired" | "not-found";

export default function PhoneUploadClient({ sessionId }: { sessionId: string }) {
  const [sessionState, setSessionState] = useState<SessionState>("checking");
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getPhotoUploadSessionStatus(sessionId)
      .then((status) => setSessionState(status.expired ? "expired" : "ready"))
      .catch(() => setSessionState("not-found"));
  }, [sessionId]);

  function handleFile(file: File) {
    setError("");
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const previewUrl = URL.createObjectURL(file);
    setPhotos((prev) => [...prev, { id, previewUrl, uploading: true, failed: false }]);

    uploadPhotoToSession(sessionId, file)
      .then(() => {
        setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, uploading: false } : p)));
      })
      .catch((err) => {
        setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, uploading: false, failed: true } : p)));
        setError(err instanceof Error ? err.message : "That photo didn't upload — try again.");
      });
  }

  if (sessionState === "checking") {
    return <CenteredMessage>Loading…</CenteredMessage>;
  }

  if (sessionState === "not-found" || sessionState === "expired") {
    return (
      <CenteredMessage>
        This link has expired. Go back to your computer and open the QR code again from the
        Sell wizard.
      </CenteredMessage>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-brand-surface px-6 py-10">
      <PhoneUploadLogo />
      <p className="text-center text-sm text-gray-500">
        Take photos of your card — they&rsquo;ll show up on your computer automatically.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="flex items-center gap-2 rounded-full bg-brand-gold px-8 py-4 text-base font-semibold text-white shadow-lg transition-colors hover:bg-brand-gold-light"
      >
        <Camera size={20} />
        Take Photo
      </button>

      {error && <p className="text-sm text-brand-urgent">{error}</p>}

      {photos.length > 0 && (
        <div className="grid w-full max-w-sm grid-cols-3 gap-2">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="relative aspect-square overflow-hidden rounded-lg border border-gray-200 bg-white"
            >
              <Image src={photo.previewUrl} alt="" fill className="object-cover" />
              {photo.uploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/60">
                  <Loader2 size={18} className="animate-spin text-brand-navy" />
                </div>
              )}
              {!photo.uploading && !photo.failed && (
                <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-white">
                  <Check size={12} />
                </div>
              )}
              {photo.failed && (
                <div className="absolute inset-0 flex items-center justify-center bg-brand-urgent/10">
                  <span className="text-[10px] font-semibold text-brand-urgent">Failed</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-gray-400">
        You can close this page once you&rsquo;re done — your photos are already saved.
      </p>
    </div>
  );
}

// Matches Header.tsx's "logo-only" variant markup (minus the Link wrapper —
// this page has nowhere useful to link home to since it's reached only via
// QR scan, never direct navigation), so this bare mobile page still reads
// as AuctionHous rather than an anonymous form.
function PhoneUploadLogo() {
  return (
    <div className="flex items-center gap-1">
      <Image src="/logo-v3.png" alt="AuctionHous" width={48} height={48} unoptimized className="h-12 w-12" />
      <span className="text-lg font-bold tracking-tight text-brand-navy">
        AuctionHous <span className="text-brand-gold">TCG</span>
      </span>
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-brand-surface px-8 text-center">
      <PhoneUploadLogo />
      <p className="text-sm text-gray-500">{children}</p>
    </div>
  );
}
