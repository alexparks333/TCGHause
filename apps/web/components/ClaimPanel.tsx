"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, MessageSquare, Send } from "lucide-react";
import {
  acceptPartialRefund,
  addClaimEvidence,
  addClaimMessage,
  appealClaim,
  escalateClaim,
  getClaimForListing,
  openClaim,
  proposePartialRefund,
  resolveClaimByAgreement,
  ApiError,
  type ClaimDetail,
  type ClaimReasonCode,
} from "@/lib/api";
import { uploadOrderEvidence } from "@/lib/storage";
import { formatPrice } from "@/lib/types";

export const REASON_LABELS: Record<ClaimReasonCode, string> = {
  not_as_described: "Item wasn't as described",
  not_received_no_tracking: "Never arrived (no tracking)",
  not_received_tracking_delivered: "Never arrived (tracking shows delivered)",
  payment_fraud: "I didn't make this purchase",
  buyers_remorse: "Changed my mind",
  transit_damage: "Arrived damaged",
};

export const STATE_LABELS: Record<string, string> = {
  opened: "Just opened",
  negotiating: "In discussion",
  escalated: "Escalated",
  auto_adjudicated: "Under review",
  human_review: "Under review",
  decided: "Decided",
  appealed: "Appeal under review",
  closed: "Closed",
};

// Design doc v2 §9 — one panel handling the whole ladder: file a claim,
// negotiate directly, propose/accept a partial refund (§9.2, expected to
// close most of these in minutes), escalate, and see/appeal a decision.
// Only ever shows up on the order-status page when a claim genuinely
// exists, or when the order is in its claim window and the viewer is the
// buyer (the only party design doc v2 §9.3's reason codes let file one).
export default function ClaimPanel({
  listingId,
  orderId,
  orderState,
  viewerIsSeller,
  notEligibleFallback,
}: {
  listingId: string;
  orderId: string;
  orderState: string;
  viewerIsSeller: boolean;
  // Rendered instead of nothing when there's no claim and this order isn't
  // eligible to start one — the order-status page (where this panel used to
  // only ever appear) is fine staying silent there, since a seller or a
  // non-claimable order just shouldn't show the panel at all. The Support
  // claim-start picker (which can land on any order a user picks) needs an
  // honest explanation instead of the panel just disappearing.
  notEligibleFallback?: React.ReactNode;
}) {
  const [detail, setDetail] = useState<ClaimDetail | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      setDetail(await getClaimForListing(listingId));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) {
        // Best-effort — a load failure just leaves the panel showing
        // whatever it already had (or nothing, on first load).
      }
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  if (loading) return null;

  if (!detail) {
    if (orderState !== "claim_window" || viewerIsSeller) return notEligibleFallback ?? null;
    return <FileClaimForm orderId={orderId} onFiled={refresh} />;
  }

  return <ClaimThread detail={detail} onChange={refresh} />;
}

function FileClaimForm({ orderId, onFiled }: { orderId: string; onFiled: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ClaimReasonCode>("not_as_described");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!open) {
    return (
      <div className="mt-6 border-t border-brand-border pt-5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-xs font-medium text-brand-urgent hover:underline"
        >
          <AlertTriangle size={14} /> Something wrong with this order?
        </button>
      </div>
    );
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError("");
    try {
      await openClaim(orderId, reason, body);
      onFiled();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-6 border-t border-brand-border pt-5">
      <h3 className="text-sm font-semibold text-gray-900">File a claim</h3>
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value as ClaimReasonCode)}
        className="mt-2 w-full rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
      >
        {Object.entries(REASON_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What happened?"
        rows={3}
        className="mt-2 w-full rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-full bg-brand-urgent px-4 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-60"
        >
          Submit claim
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-gray-500 hover:underline"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-brand-urgent">{error}</p>}
    </div>
  );
}

function ClaimThread({
  detail,
  onChange,
}: {
  detail: ClaimDetail;
  onChange: () => void;
}) {
  const { claim, events } = detail;
  const [message, setMessage] = useState("");
  const [offerAmount, setOfferAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const latestOffer = [...events].reverse().find((e) => e.kind === "partial_refund_offer");
  const negotiating = claim.state === "negotiating";

  return (
    <div className="mt-6 border-t border-brand-border pt-5">
      <div className="flex flex-wrap items-center gap-2">
        <MessageSquare size={16} className="text-brand-urgent" />
        <h3 className="text-sm font-semibold text-gray-900">
          Claim — {REASON_LABELS[claim.reasonCode]}
        </h3>
        <span className="rounded-full bg-brand-navy/10 px-2 py-0.5 text-[11px] font-mono font-semibold text-brand-navy">
          {claim.ticketNumber}
        </span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
          {STATE_LABELS[claim.state] ?? claim.state}
        </span>
      </div>

      {claim.resolution && (
        <p className="mt-2 text-sm text-gray-700">
          Resolution: <span className="font-medium">{claim.resolution.replace(/_/g, " ")}</span>
          {claim.refundCents ? ` — ${formatPrice(claim.refundCents)}` : ""}
        </p>
      )}

      <div className="mt-3 flex max-h-64 flex-col gap-2 overflow-y-auto rounded-lg bg-brand-surface p-3">
        {events.map((e) => (
          <div key={e.id} className="text-xs text-gray-600">
            {e.kind === "message" && <p>{e.body}</p>}
            {e.kind === "evidence" && (
              <a href={e.body} target="_blank" rel="noreferrer" className="text-brand-navy hover:underline">
                Evidence photo
              </a>
            )}
            {e.kind === "partial_refund_offer" && (
              <p className="font-medium text-gray-900">
                Partial refund offered: {formatPrice(e.amountCents ?? 0)}
              </p>
            )}
            {(e.kind === "decision" || e.kind === "appeal" || e.kind === "escalation") && (
              <p className="italic">{e.body}</p>
            )}
          </div>
        ))}
        {events.length === 0 && <p className="text-xs text-gray-400">No messages yet.</p>}
      </div>

      {negotiating && (
        <>
          <div className="mt-3 flex gap-2">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Send a message"
              className="flex-1 rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
            />
            <button
              type="button"
              disabled={busy || !message}
              onClick={() =>
                run(async () => {
                  await addClaimMessage(claim.id, message);
                  setMessage("");
                })
              }
              className="rounded-lg bg-brand-navy px-3 py-2 text-white transition-colors hover:bg-brand-navy-light disabled:opacity-60"
            >
              <Send size={14} />
            </button>
          </div>

          <label className="mt-2 inline-block cursor-pointer text-xs font-medium text-brand-navy hover:underline">
            Attach a photo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                run(async () => {
                  const url = await uploadOrderEvidence(claim.orderId, file);
                  await addClaimEvidence(claim.id, url);
                });
              }}
            />
          </label>

          {latestOffer ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => acceptPartialRefund(claim.id))}
              className="mt-3 block rounded-full bg-brand-success px-4 py-2 text-sm font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-60"
            >
              Accept {formatPrice(latestOffer.amountCents ?? 0)} partial refund
            </button>
          ) : (
            <div className="mt-3 flex gap-2">
              <input
                value={offerAmount}
                onChange={(e) => setOfferAmount(e.target.value)}
                placeholder="Refund amount, e.g. 5.00"
                className="flex-1 rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
              />
              <button
                type="button"
                disabled={busy || !offerAmount}
                onClick={() =>
                  run(async () => {
                    const cents = Math.round(parseFloat(offerAmount) * 100);
                    await proposePartialRefund(claim.id, cents);
                    setOfferAmount("");
                  })
                }
                className="whitespace-nowrap rounded-lg border border-brand-border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-brand-surface disabled:opacity-60"
              >
                Propose "keep it, refund X"
              </button>
            </div>
          )}

          <div className="mt-3 flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => resolveClaimByAgreement(claim.id))}
              className="text-xs font-medium text-brand-success hover:underline disabled:opacity-60"
            >
              Mark resolved, no refund
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => escalateClaim(claim.id))}
              className="text-xs font-medium text-brand-urgent hover:underline disabled:opacity-60"
            >
              Escalate this claim
            </button>
          </div>
        </>
      )}

      {claim.state === "decided" && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(() => appealClaim(claim.id, "Requesting a second review."))
          }
          className="mt-3 text-xs font-medium text-brand-navy hover:underline disabled:opacity-60"
        >
          Appeal this decision
        </button>
      )}

      {error && <p className="mt-2 text-xs text-brand-urgent">{error}</p>}
    </div>
  );
}
