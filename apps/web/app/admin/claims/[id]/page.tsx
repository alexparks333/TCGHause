import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import AdminClaimDecide from "@/components/AdminClaimDecide";
import { REASON_LABELS, STATE_LABELS } from "@/components/ClaimPanel";
import { ApiError, getAdminClaim } from "@/lib/api";
import { formatPrice } from "@/lib/types";
import { getLocalSession } from "@/lib/session";

export const metadata = {
  title: "Claim | AuctionHous - TCG",
};

export default async function AdminClaimDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const local = await getLocalSession();
  if (!local) redirect("/login");

  let error = "";
  const detail = await getAdminClaim(id, local.accessToken).catch((err) => {
    if (err instanceof ApiError && err.status === 404) notFound();
    error =
      err instanceof ApiError && err.status === 403
        ? "You don't have access to this page."
        : err instanceof Error
          ? err.message
          : "Failed to load this claim.";
    return null;
  });

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Link href="/admin/claims" className="text-xs font-medium text-brand-navy hover:underline">
        &larr; Claims queue
      </Link>

      {error && <p className="mt-6 text-sm text-brand-urgent">{error}</p>}

      {detail && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">{detail.claim.ticketNumber}</h1>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
              {STATE_LABELS[detail.claim.state] ?? detail.claim.state}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-600">{REASON_LABELS[detail.claim.reasonCode]}</p>

          <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-brand-border">
            <p className="text-sm font-semibold text-gray-900">{detail.claim.listingTitle}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500 sm:grid-cols-4">
              <div>
                <dt className="text-gray-400">Amount</dt>
                <dd className="text-gray-700">{formatPrice(detail.claim.chargedCents)}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Buyer</dt>
                <dd className="text-gray-700">{detail.claim.buyerUsername}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Seller</dt>
                <dd className="text-gray-700">{detail.claim.sellerUsername}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Order status</dt>
                <dd className="text-gray-700">{detail.claim.orderState}</dd>
              </div>
            </dl>
          </div>

          <AdminClaimDecide detail={detail} />
        </>
      )}
    </div>
  );
}
