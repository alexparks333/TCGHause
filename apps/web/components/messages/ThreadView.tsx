"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, HandCoins, Send, X } from "lucide-react";
import Avatar from "@/components/Avatar";
import ListingImage from "@/components/ListingImage";
import { acceptOffer, declineOffer, type ChatMessageOffer, type MessageThreadDetail } from "@/lib/api";
import { formatOfferStatus, formatPrice, offerStatusBadgeClass } from "@/lib/types";
import { formatRelativeTime } from "@/lib/format";

type Outcome = "accepted" | "declined";

function outcomeFromStatus(status: ChatMessageOffer["status"]): Outcome | null {
  if (status === "accepted") return "accepted";
  if (status === "declined") return "declined";
  return null;
}

// The seller-facing accept/decline pair on a pending offer bubble — same
// underlying acceptOffer/declineOffer calls as OffersPanel/BidsOffersApp,
// so an offer is genuinely one piece of state no matter which of the three
// surfaces someone acts on it from: accepting here rejects a second accept
// attempt on the listing page (and vice versa) exactly like accepting there
// already rejects a second attempt here, both via the same ErrNotPending
// guard server-side. onResolved re-fetches this thread immediately after a
// successful response, rather than waiting for the next poll tick, so the
// bubble's own status flips right away.
function OfferBubble({
  offer,
  mine,
  currentUserId,
  onResolved,
}: {
  offer: ChatMessageOffer;
  mine: boolean;
  currentUserId: string;
  onResolved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolved offers (either direction) keep their bubble as real chat
  // history (unlike the listing page, which drops a declined one outright)
  // — and the ribbon that lands on resolution is a permanent fixture from
  // then on, not a flash that fades: full gold card + gold "Accepted"
  // ribbon, or faded grey card + grey "Declined" ribbon, stay put exactly
  // like a real wax seal would. outcome is tracked separately from
  // offer.status because it needs to flip the instant a click succeeds,
  // before onResolved()'s refetch has actually landed a fresh offer.status
  // — conditionally rendering the ribbon off this state (rather than
  // offer.status directly) is also what makes it mount-and-play its
  // one-time sweep-in animation (animate-ended-ribbon's `forwards` fill
  // mode holds its final frame forever after) the instant it appears,
  // whether that's live right now or on first opening an already-resolved
  // thread later.
  const [outcome, setOutcome] = useState<Outcome | null>(outcomeFromStatus(offer.status));
  const canRespond = offer.sellerId === currentUserId && offer.status === "pending" && outcome === null;

  // Resolving the SAME offer from the listing page or Bids/Offers while
  // this exact thread happens to be open won't come through respond()
  // below at all — it only ever reaches this component as a fresh
  // offer.status on the next poll (MessagesApp's OPEN_THREAD_POLL_MS).
  // outcome's own useState initializer only ever runs once, at mount, so
  // without this it would keep showing stale Accept/Decline buttons (or
  // the old small status pill instead of the permanent ribbon) until the
  // whole thread were closed and reopened. This is what makes it pick up
  // an external resolution the moment the next poll delivers it instead.
  useEffect(() => {
    const resolved = outcomeFromStatus(offer.status);
    if (resolved !== null) {
      setOutcome(resolved);
    }
  }, [offer.status]);

  async function respond(action: "accept" | "decline") {
    setBusy(true);
    setError(null);
    try {
      if (action === "accept") {
        await acceptOffer(offer.id);
        setOutcome("accepted");
      } else {
        await declineOffer(offer.id);
        setOutcome("declined");
      }
      onResolved();
    } catch (err) {
      // Most likely cause: someone else (or this same seller, another tab)
      // already resolved this exact offer — the server's own ErrNotPending
      // guard is what actually prevents a double-resolution, this is just
      // the UI catching up. Re-fetching immediately, rather than waiting
      // for the next poll tick, means the buttons that just failed don't
      // keep sitting there looking clickable.
      setError(err instanceof Error ? err.message : "Failed to respond to offer.");
      setBusy(false);
      onResolved();
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div
        className={`relative overflow-hidden rounded-2xl border p-3 w-60 ${
          // Still pending reads as light gold — genuinely live, something
          // to actually look at. Resolving it (here or elsewhere) settles
          // the whole card permanently: fully gold for accepted, faded grey
          // for declined — same colors this app already uses for those two
          // outcomes everywhere else, just filling the whole card instead
          // of a small badge.
          outcome === "accepted"
            ? "border-brand-gold bg-brand-gold"
            : outcome === "declined"
              ? "border-brand-border bg-brand-surface"
              : offer.status === "pending"
                ? "border-brand-gold/50 bg-brand-gold/[0.18]"
                : mine
                  ? "border-brand-navy/15 bg-brand-navy/5"
                  : "border-brand-border bg-white"
        }`}
      >
        <div
          className={`flex items-center gap-1.5 text-xs font-medium ${
            outcome === "accepted" ? "text-white/90" : "text-gray-500"
          }`}
        >
          <HandCoins size={13} /> Offer
        </div>
        <p className={`mt-1 text-xl font-bold ${outcome === "accepted" ? "text-white" : "text-gray-900"}`}>
          {formatPrice(offer.amountCents)}
        </p>
        <Link
          href={`/listing/${offer.listingId}`}
          className={`block truncate text-xs hover:underline ${
            outcome === "accepted" ? "text-white/90 hover:text-white" : "text-gray-500 hover:text-brand-navy"
          }`}
        >
          {offer.listingTitle}
        </Link>
        {outcome ? (
          // A flat banner below the amount/title, not a diagonal sash
          // overlaid on top of them — bleeds to the card's own edges
          // (-mx-3 -mb-3 cancels the card's p-3) so it reads as a ribbon
          // fixed along the bottom rather than floating content. Permanent
          // once it lands (see outcome's own doc comment for why), not a
          // flash that fades. The white ring is what keeps "Accepted"
          // reading as a distinct ribbon once the card behind it is the
          // same gold.
          <div
            className={`animate-sticker-land mt-2.5 -mx-3 -mb-3 rounded-b-2xl py-1.5 text-center text-xs font-extrabold uppercase tracking-wider text-white shadow-inner ring-2 ring-inset ring-white/70 ${
              outcome === "accepted" ? "bg-brand-gold" : "bg-gray-700"
            }`}
          >
            {outcome === "accepted" ? "Accepted" : "Declined"}
          </div>
        ) : canRespond ? (
          <div className="mt-2.5 flex gap-1.5">
            <button
              type="button"
              onClick={() => respond("accept")}
              disabled={busy}
              className="flex items-center gap-1 rounded-lg bg-brand-success px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-success/90 disabled:opacity-50"
            >
              <Check size={13} /> Accept
            </button>
            <button
              type="button"
              onClick={() => respond("decline")}
              disabled={busy}
              className="flex items-center gap-1 rounded-lg border border-brand-border px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:bg-brand-surface disabled:opacity-50"
            >
              <X size={13} /> Decline
            </button>
          </div>
        ) : (
          <span
            className={`mt-2.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${offerStatusBadgeClass(offer.status)}`}
          >
            {formatOfferStatus(offer.status)}
          </span>
        )}
        {error && <p className="mt-1.5 text-[11px] text-brand-urgent">{error}</p>}
      </div>
      {/* The card being offered on, at a glance, right next to the offer
          itself — same "About: <title>" reasoning as the thread header's
          own listing chip, just per-offer instead of once for the whole
          conversation (a thread can span multiple listings/offers).
          Permanently dimmed once declined (a successful sale stays full
          color — nothing to fade there) — see outcome's own doc comment. */}
      <Link
        href={`/listing/${offer.listingId}`}
        className="relative block aspect-[5/7] w-16 shrink-0 overflow-hidden rounded-lg border border-brand-border shadow-md transition-transform duration-200 hover:scale-110 hover:shadow-lg"
      >
        <div
          className={`h-full w-full transition-all duration-700 ${
            outcome === "declined" ? "grayscale opacity-40" : ""
          }`}
        >
          <ListingImage src={offer.listingImageUrl} game={offer.listingGame} label={offer.listingTitle} />
        </div>
        {outcome && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden">
            <div
              className={`w-[160%] animate-ended-ribbon py-0.5 text-center text-[9px] font-extrabold uppercase tracking-wider text-white shadow-lg ring-1 ring-white/80 ${
                outcome === "accepted" ? "bg-brand-gold" : "bg-gray-700"
              }`}
            >
              {outcome === "accepted" ? "Accepted" : "Declined"}
            </div>
          </div>
        )}
      </Link>
    </div>
  );
}

export default function ThreadView({
  detail,
  currentUserId,
  onBack,
  onSend,
  onOfferResolved,
}: {
  detail: MessageThreadDetail;
  currentUserId: string;
  onBack: () => void;
  onSend: (body: string) => Promise<void>;
  // Called after an Accept/Decline click in this thread succeeds — see
  // OfferBubble's own doc comment for why this refetches immediately
  // instead of waiting on the thread's own poll.
  onOfferResolved: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const name = detail.counterpart.username ?? "Deleted user";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [detail.id, detail.messages.length]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    setDraft("");
    try {
      await onSend(body);
    } catch {
      setError("Message didn't send — try again.");
      setDraft(body);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-brand-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="rounded-md p-1 text-gray-500 hover:bg-brand-surface md:hidden"
        >
          <ArrowLeft size={18} />
        </button>
        <Avatar label={name} size={36} />
        <div className="min-w-0 flex-1">
          {detail.counterpart.username ? (
            <Link
              href={`/seller/${detail.counterpart.username}`}
              className="truncate text-sm font-semibold text-gray-900 hover:underline"
            >
              {name}
            </Link>
          ) : (
            <p className="truncate text-sm font-semibold text-gray-900">{name}</p>
          )}
        </div>
      </div>

      {detail.listing && (
        <Link
          href={`/listing/${detail.listing.id}`}
          className="flex items-center gap-2.5 border-b border-brand-border bg-brand-surface px-4 py-2 text-xs text-gray-600 hover:bg-brand-border/40"
        >
          <div className="relative aspect-[5/7] w-6 shrink-0 overflow-hidden rounded">
            {/* game is only optional in the shared type because
                ThreadSummary reuses it without populating it —
                GetThreadDetail (the only source for this specific field)
                always sets a real one, the fallback here is unreachable in
                practice. */}
            <ListingImage
              src={detail.listing.imageUrl}
              game={detail.listing.game ?? "Pokémon"}
              label={detail.listing.title}
            />
          </div>
          <span className="truncate">
            About: <span className="font-medium text-gray-800">{detail.listing.title}</span>
          </span>
        </Link>
      )}

      {/* min-h-0 overrides a flex item's default min-height:auto, which
          otherwise lets it grow past flex-1's share to fit its own content
          instead of shrinking to it and scrolling — the actual mechanism
          that makes this list scroll internally within MessagesApp's fixed-
          height box rather than pushing that box (and the page) taller. */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {detail.messages.map((m) => {
          const mine = m.senderId === currentUserId;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                {m.kind === "offer" && m.offer ? (
                  <OfferBubble
                    offer={m.offer}
                    mine={mine}
                    currentUserId={currentUserId}
                    onResolved={onOfferResolved}
                  />
                ) : (
                  <div
                    className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${
                      mine
                        ? "rounded-br-sm bg-brand-navy text-white"
                        : "rounded-bl-sm bg-brand-surface text-gray-800"
                    }`}
                  >
                    {m.body}
                  </div>
                )}
                {/* Date.now()-based text — see ThreadListItem's matching
                    comment for why this needs suppressHydrationWarning, not
                    a fix elsewhere. */}
                <span className="mt-0.5 px-1 text-[11px] text-gray-400" suppressHydrationWarning>
                  {formatRelativeTime(m.createdAt)}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-brand-border p-3">
        {error && <p className="mb-1.5 text-xs text-brand-urgent">{error}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={`Message ${name}...`}
            rows={1}
            className="max-h-32 flex-1 resize-none rounded-xl border border-brand-border px-3.5 py-2.5 text-sm outline-none focus:border-brand-navy"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!draft.trim() || sending}
            aria-label="Send message"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-navy text-white transition-colors hover:bg-brand-navy-light disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
