"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { HandCoins, X } from "lucide-react";
import { submitOffer, ApiError } from "@/lib/api";
import { formatPrice } from "@/lib/types";

// The buyer-facing entry point into internal/offer — only ever rendered
// when the listing itself has allowOffers set (ListingGallery/
// AuctionPriceBox check that, not this component, since "should this even
// show up" is a listing-level fact, not something worth duplicating here).
// Same centered-modal shape as MessageSellerButton for the same reason:
// this is a one-off "pop up, propose a number, gone" interaction, not
// something you stay in.
export default function MakeOfferButton({
  listingId,
  binPriceCents,
  minOfferCents,
  isOwnListing = false,
  variant = "full",
}: {
  listingId: string;
  binPriceCents: number;
  // Undefined means the seller didn't set a floor — any positive amount
  // under binPriceCents is a valid offer.
  minOfferCents?: number;
  // The button itself stays visible and clickable for the listing's own
  // seller (product decision — this is deliberately NOT hidden the way the
  // listing detail page's OwnerListingBanner hides it entirely). Instead,
  // clicking it opens OwnOfferNotice below instead of the real offer form —
  // the backend would reject a self-offer anyway (internal/offer.
  // ErrSelfOffer), so this just gets the "why not" in front of the seller
  // immediately instead of after a failed submit.
  isOwnListing?: boolean;
  // "icon" is the compact rounded-square trigger used next to BuyNowButton
  // on ListingCard's fixed-price badge — same handshake icon, same modal,
  // just no label so it fits beside the price button instead of stacking
  // beneath it. "full" (default) is the labeled pill used on the listing
  // detail page and AuctionPriceBox.
  variant?: "full" | "icon";
}) {
  const [open, setOpen] = useState(false);
  const [ownNotice, setOwnNotice] = useState(false);
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const anyModalOpen = open || ownNotice;
  useEffect(() => {
    if (!anyModalOpen) return;
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
  }, [anyModalOpen]);

  function handleTriggerClick() {
    if (isOwnListing) {
      setOwnNotice(true);
    } else {
      setOpen(true);
    }
  }

  function close() {
    if (sending) return;
    setOpen(false);
    setOwnNotice(false);
    setAmount("");
    setError("");
  }

  const amountCents = Math.round(Number.parseFloat(amount || "0") * 100);
  // Mirrors internal/offer.Submit's own gates — checked here too so the
  // buyer sees this before submitting, not just as a server error after
  // the fact. The server re-checks regardless.
  const belowMinimum = minOfferCents != null && amountCents < minOfferCents;
  const atOrAboveBin = amountCents >= binPriceCents;
  const invalid = !amount.trim() || amountCents <= 0 || belowMinimum || atOrAboveBin;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (invalid || sending) return;
    setSending(true);
    setError("");
    try {
      await submitOffer(listingId, amountCents);
      setOpen(false);
      setAmount("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send offer.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={handleTriggerClick}
          aria-label="Make an offer"
          title="Make an offer"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-brand-navy text-brand-navy transition-colors hover:bg-brand-navy/5"
        >
          <HandCoins size={18} />
        </button>
      ) : (
        <button
          type="button"
          onClick={handleTriggerClick}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-brand-navy px-4 py-2.5 text-sm font-semibold text-brand-navy transition-colors hover:bg-brand-navy/5"
        >
          <HandCoins size={16} /> Make an Offer
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div role="dialog" aria-modal="true" aria-label="Make an offer" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-900">Make an Offer</h2>
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
              <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
                Your offer
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    $
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    autoFocus
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-brand-border py-2 pl-6 pr-3 text-sm outline-none focus:border-brand-navy"
                  />
                </div>
              </label>
              {belowMinimum && minOfferCents != null && (
                <p className="text-xs text-brand-urgent">
                  Must be at least {formatPrice(minOfferCents)}.
                </p>
              )}
              {!belowMinimum && atOrAboveBin && amount.trim() && (
                <p className="text-xs text-brand-urgent">
                  Must be less than {formatPrice(binPriceCents)} — that&apos;s the Buy It Now price.
                </p>
              )}
              {error && <p className="text-xs text-brand-urgent">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={invalid || sending}
                  className="flex-1 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy-light disabled:opacity-50"
                >
                  {sending ? "Sending..." : "Send Offer"}
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

      {ownNotice && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Make an offer"
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-900">Make an Offer</h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded-md p-1 text-gray-400 transition-colors hover:bg-brand-surface hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>
            <p className="mt-3 text-sm text-gray-600">
              This is your listing. You can&apos;t make an offer on your own listing.
            </p>
            <button
              type="button"
              onClick={close}
              className="mt-4 w-full rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy-light"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
