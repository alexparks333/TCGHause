"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ExternalLink } from "lucide-react";
import {
  createSellerOnboardingLink,
  getSellerConnectStatusClient,
  type SellerConnectStatus,
} from "@/lib/api";

// "Set up payouts" in Account Settings — Stripe Connect Express onboarding
// (design doc v2 §5.1/§7). Money from a sale goes straight into the
// seller's OWN Stripe balance the moment a direct charge succeeds; this
// isn't a platform-held wallet or deposit of any kind, it's identity
// verification so Stripe knows who to pay. Deliberately separate from
// SavedCardsManager above — that's a buyer's saved-card identity, this is
// a seller's merchant identity, and the same person can be both.
//
// Deliberately does NOT offer a "get paid now" button once onboarded —
// that used to live here (an earlier InstantPayoutButton) with zero
// balance visibility, before the Withdraw page (app/account/withdraw)
// existed as the one real place to see what's available and actually
// withdraw it, Standard or Instant. This component's job ends at "you're
// verified," full stop.
export default function SellerPayoutsSetup({
  initialStatus,
  returnPath,
}: {
  initialStatus: SellerConnectStatus;
  // Where Stripe sends the seller back to once onboarding completes —
  // Account Settings by default; the Sell page passes "/sell" so a seller
  // prompted mid-listing-creation lands back on the wizard, not Settings.
  returnPath?: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Refresh once on mount — covers the case where this render happened
  // right after redirecting back from Stripe's hosted onboarding flow
  // (?connect=return), before the account.updated webhook has necessarily
  // landed. Best-effort only: the webhook (internal/webhook) is the real
  // source of truth for onboarding completion, never this client-side read.
  useEffect(() => {
    getSellerConnectStatusClient()
      .then(setStatus)
      .catch(() => {
        // Best-effort — initialStatus (server-fetched) stays as the shown state.
      });
  }, []);

  async function handleSetUp() {
    setLoading(true);
    setError("");
    try {
      const { url } = await createSellerOnboardingLink(returnPath);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  const fullyOnboarded = status.chargesEnabled && status.payoutsEnabled;

  return (
    <div className="mt-4">
      {fullyOnboarded ? (
        <div className="flex items-center gap-2 rounded-lg bg-brand-success/10 px-3 py-2 text-sm font-medium text-brand-success">
          <ShieldCheck size={16} />
          Payouts are set up — you're ready to sell.
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500">
            {status.hasAccount
              ? "Almost there — Stripe still needs a bit more information before you can get paid out."
              : "Verify your identity with Stripe so we know where to send your sale proceeds. Takes a couple of minutes, and it's the same setup either way you get paid."}
          </p>
          <button
            type="button"
            onClick={handleSetUp}
            disabled={loading}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-brand-gold px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
          >
            {status.hasAccount ? "Finish setup" : "Set up payouts"}
            <ExternalLink size={14} />
          </button>
        </>
      )}
      {error && <p className="mt-2 text-xs text-brand-urgent">{error}</p>}
    </div>
  );
}
