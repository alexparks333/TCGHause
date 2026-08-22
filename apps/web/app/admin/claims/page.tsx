import Link from "next/link";
import { redirect } from "next/navigation";
import { STATE_LABELS, REASON_LABELS } from "@/components/ClaimPanel";
import { ApiError, getAdminClaims, type AdminClaimSummary, type ClaimState } from "@/lib/api";
import { formatPrice } from "@/lib/types";
import { getLocalSession } from "@/lib/session";
import { paramStr, type SearchParams } from "@/lib/search-params";

export const metadata = {
  title: "Claims Queue | AuctionHous - TCG",
};

// The Workers side's first page — a queue over the claim state machine
// apps/api/internal/dispute already fully implements (state transitions,
// auto-adjudication, Stripe refund execution). This page adds nothing to
// that logic, it just turns the existing admin-only decide/decide-appeal
// endpoints into something a hired reviewer can click through instead of
// calling with curl. Same minimal-admin-surface caveat as /admin/metrics:
// gated by ADMIN_EMAILS, not a real role system.
// "all" is its own sentinel value, distinct from the param being absent —
// distinguishing "no ?state= yet, default to Needs Review" from "the All
// tab was explicitly clicked, show everything" is what makes the All tab
// actually work instead of just re-showing the default filter.
const TABS: { label: string; state: "human_review" | "appealed" | "all" }[] = [
  { label: "Needs Review", state: "human_review" },
  { label: "Appealed", state: "appealed" },
  { label: "All", state: "all" },
];

export default async function AdminClaimsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const local = await getLocalSession();
  if (!local) redirect("/login");

  const params = await searchParams;
  const activeState = paramStr(params, "state") ?? "human_review";
  const stateFilter = activeState === "all" ? undefined : (activeState as ClaimState);

  let error = "";
  const claims = await getAdminClaims(local.accessToken, stateFilter).catch((err) => {
    error =
      err instanceof ApiError && err.status === 403
        ? "You don't have access to this page."
        : err instanceof Error
          ? err.message
          : "Failed to load claims.";
    return null;
  });

  return (
    <div className="mx-auto w-full max-w-4xl">
      <h1 className="text-xl font-bold text-gray-900">Claims queue</h1>
      <p className="mt-1 text-sm text-gray-500">
        Every claim gets a ticket number when it's filed — pick one up to review the thread and
        decide it.
      </p>

      <div className="mt-4 flex gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.label}
            href={tab.state ? `/admin/claims?state=${tab.state}` : "/admin/claims"}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              activeState === tab.state
                ? "bg-brand-navy text-white"
                : "bg-white text-gray-700 ring-1 ring-brand-border hover:bg-brand-surface"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {error && <p className="mt-6 text-sm text-brand-urgent">{error}</p>}

      {claims && (
        <div className="mt-4 flex flex-col gap-2">
          {claims.length === 0 && (
            <p className="mt-6 text-sm text-gray-400">Nothing in this view right now.</p>
          )}
          {claims.map((c) => (
            <ClaimRow key={c.id} claim={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function ClaimRow({ claim }: { claim: AdminClaimSummary }) {
  return (
    <Link
      href={`/admin/claims/${claim.id}`}
      className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-brand-border transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <span className="rounded-full bg-brand-navy/10 px-2 py-0.5 text-[11px] font-mono font-semibold text-brand-navy">
        {claim.ticketNumber}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">
        {claim.listingTitle}
      </span>
      <span className="text-xs text-gray-500">{REASON_LABELS[claim.reasonCode]}</span>
      <span className="text-xs text-gray-400">
        {claim.buyerUsername} &rarr; {claim.sellerUsername}
      </span>
      <span className="text-sm font-semibold text-gray-900">{formatPrice(claim.chargedCents)}</span>
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
        {STATE_LABELS[claim.state] ?? claim.state}
      </span>
    </Link>
  );
}
