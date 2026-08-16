"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, X } from "lucide-react";
import { startMessageThread } from "@/lib/api";

// The entry point into internal/message from anywhere a seller is shown —
// listing detail's SellerCard and the seller profile page. A centered
// modal (backdrop blur, Escape/click-outside/X all cancel) rather than an
// inline expanding form — this is deliberately only for the *first*
// message that starts a conversation; the real thread view
// (ThreadView/MessagesApp) has its own always-visible inline composer,
// since a modal only makes sense for a one-off "pop up, write, send, gone"
// interaction, not a conversation you stay in.
export default function MessageSellerButton({
  recipientId,
  recipientLabel,
  listingId,
}: {
  recipientId: string;
  recipientLabel: string;
  listingId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  // Body scroll lock + Escape-to-close while the modal is open — restored
  // on close/unmount either way, so navigating away mid-send never leaves
  // the page stuck unscrollable.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    if (sending) return;
    setOpen(false);
    setBody("");
    setError("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const detail = await startMessageThread(recipientId, body.trim(), listingId);
      setOpen(false);
      router.push(`/account/messages?thread=${detail.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-brand-border px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-brand-surface"
      >
        <MessageCircle size={15} /> Message {recipientLabel}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={(e) => {
            // Only the backdrop itself (not the modal card) should close —
            // stopPropagation on the card below would work too, but
            // checking the click target directly here avoids needing an
            // extra wrapper.
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Message ${recipientLabel}`}
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-900">Message {recipientLabel}</h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded-md p-1 text-gray-400 transition-colors hover:bg-brand-surface hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                autoFocus
                rows={4}
                maxLength={4000}
                placeholder={`Ask ${recipientLabel} a question...`}
                className="rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
              />
              {error && <p className="text-xs text-brand-urgent">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={!body.trim() || sending}
                  className="flex-1 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy-light disabled:opacity-50"
                >
                  {sending ? "Sending..." : "Send"}
                </button>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg border border-brand-border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-brand-surface"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
