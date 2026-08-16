"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { Smartphone } from "lucide-react";
import { createPhotoUploadSession, getPhotoUploadSessionPhotosClient } from "@/lib/api";

// Matches MessagesApp.tsx's OPEN_THREAD_POLL_MS — this panel only polls
// while it's actually visible/expanded, the same "actively watched" case,
// not the slower passive-list tier.
const POLL_MS = 4000;

export default function PhoneUploadPanel({
  onPhotosFound,
}: {
  onPhotosFound: (urls: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [session, setSession] = useState<{ id: string; expiresAt: string } | null>(null);
  const [error, setError] = useState("");
  // Guards a poll response that lands after the panel's been collapsed (and
  // the session cleared) — same stale-response guard MessagesApp.tsx uses
  // for its open-thread poll.
  const sessionIdRef = useRef<string | null>(null);

  async function handleExpand() {
    setExpanded(true);
    if (session) return;
    try {
      const s = await createPhotoUploadSession();
      setSession(s);
      sessionIdRef.current = s.id;
    } catch {
      setError("Couldn't start a phone upload session — try again.");
    }
  }

  function handleCollapse() {
    setExpanded(false);
    setSession(null);
    sessionIdRef.current = null;
  }

  useEffect(() => {
    if (!expanded || !session) return;
    const id = setInterval(async () => {
      try {
        const urls = await getPhotoUploadSessionPhotosClient(session.id);
        if (sessionIdRef.current === session.id) onPhotosFound(urls);
      } catch {
        // Best-effort, same as MessagesApp.tsx's polling — a missed poll
        // just gets retried next interval.
      }
    }, POLL_MS);
    return () => clearInterval(id);
    // onPhotosFound is Step2Photos's setPhonePhotos passed straight through
    // (a stable setState reference, never an inline wrapper), so including
    // it here is safe and doesn't churn the interval on every render.
  }, [expanded, session, onPhotosFound]);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={handleExpand}
        className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-500 transition-colors hover:border-brand-navy hover:bg-brand-surface hover:text-brand-navy"
      >
        <Smartphone size={16} />
        Or scan to upload from your phone
      </button>
    );
  }

  // Safe to read window here (no SSR/hydration mismatch risk): session is
  // only ever set from handleExpand, a client-only click handler, so this
  // line never runs during server rendering.
  const qrUrl = session ? `${window.location.origin}/sell/phone-upload/${session.id}` : "";

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-gray-200 bg-brand-surface p-5 text-center">
      {error && <p className="text-xs text-brand-urgent">{error}</p>}
      {qrUrl && (
        <>
          <div className="rounded-xl bg-white p-3 shadow-sm">
            <QRCode value={qrUrl} size={160} />
          </div>
          <p className="max-w-xs text-xs text-gray-500">
            Scan with your phone&rsquo;s camera app, take photos there — they&rsquo;ll show up here
            automatically, no login needed.
          </p>
        </>
      )}
      <button
        type="button"
        onClick={handleCollapse}
        className="text-xs font-semibold text-gray-500 underline-offset-2 hover:underline"
      >
        Hide
      </button>
    </div>
  );
}
