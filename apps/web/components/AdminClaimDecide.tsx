"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gavel } from "lucide-react";
import {
  decideClaim,
  decideClaimAppeal,
  type AdminClaimDetail,
  type ClaimLiableParty,
  type ClaimResolution,
} from "@/lib/api";
import { formatPrice } from "@/lib/types";

const RESOLUTION_LABELS: Record<ClaimResolution, string> = {
  refund_buyer: "Refund buyer in full",
  deny: "Deny claim",
  partial_refund: "Partial refund",
  platform_absorb: "Platform absorbs (refund buyer, seller keeps the sale)",
};

const LIABLE_LABELS: Record<ClaimLiableParty, string> = {
  seller: "Seller",
  buyer: "Buyer",
  platform: "Platform",
};

// The one interactive piece of the claim detail screen — a read-only
// negotiation thread (same events ClaimThread renders for buyer/seller,
// just without any of their mutation actions, since an admin is neither
// party) plus the decide form that calls the decide/decide-appeal endpoints
// apps/api/internal/dispute already fully implements.
export default function AdminClaimDecide({ detail }: { detail: AdminClaimDetail }) {
  const router = useRouter();
  const { claim, events } = detail;
  const [resolution, setResolution] = useState<ClaimResolution>("refund_buyer");
  const [liableParty, setLiableParty] = useState<ClaimLiableParty>("seller");
  const [refundAmount, setRefundAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const decidable = claim.state === "human_review" || claim.state === "appealed";

  async function handleDecide() {
    setSubmitting(true);
    setError("");
    try {
      const input = {
        resolution,
        liableParty,
        refundCents: resolution === "partial_refund" ? Math.round(parseFloat(refundAmount || "0") * 100) : 0,
      };
      if (claim.state === "appealed") {
        await decideClaimAppeal(claim.id, input);
      } else {
        await decideClaim(claim.id, input);
      }
      router.push("/admin/claims");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4">
      <h2 className="text-sm font-semibold text-gray-900">Thread</h2>
      <div className="mt-2 flex max-h-80 flex-col gap-2 overflow-y-auto rounded-xl bg-white p-4 shadow-sm ring-1 ring-brand-border">
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

      {decidable ? (
        <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-brand-border">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <Gavel size={16} /> {claim.state === "appealed" ? "Decide appeal" : "Decide claim"}
          </div>

          <label className="mt-3 block text-xs font-medium text-gray-500">Resolution</label>
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value as ClaimResolution)}
            className="mt-1 w-full rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
          >
            {Object.entries(RESOLUTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <label className="mt-3 block text-xs font-medium text-gray-500">Liable party</label>
          <select
            value={liableParty}
            onChange={(e) => setLiableParty(e.target.value as ClaimLiableParty)}
            className="mt-1 w-full rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
          >
            {Object.entries(LIABLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          {resolution === "partial_refund" && (
            <>
              <label className="mt-3 block text-xs font-medium text-gray-500">Refund amount</label>
              <input
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                placeholder="e.g. 5.00"
                className="mt-1 w-full rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
              />
            </>
          )}

          <button
            type="button"
            onClick={handleDecide}
            disabled={submitting || (resolution === "partial_refund" && !refundAmount)}
            className="mt-4 rounded-full bg-brand-navy px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-navy-light disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Submit decision"}
          </button>
          {error && <p className="mt-2 text-xs text-brand-urgent">{error}</p>}
        </div>
      ) : (
        <p className="mt-4 text-xs text-gray-400">
          {claim.state === "decided" || claim.state === "closed"
            ? `Already decided${claim.resolution ? ` — ${claim.resolution.replace(/_/g, " ")}` : ""}.`
            : "This claim isn't awaiting a decision right now."}
        </p>
      )}
    </div>
  );
}
