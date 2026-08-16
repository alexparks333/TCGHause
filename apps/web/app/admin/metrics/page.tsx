import { redirect } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { ApiError, getAdminMetrics } from "@/lib/api";
import { formatPrice } from "@/lib/types";
import { getLocalSession } from "@/lib/session";

// The internal reporting snapshot design doc v2 §11 calls for —
// instrumented from day one, per the doc's own framing, even before real
// traffic makes these numbers meaningful. Admin-only: the API itself
// enforces the email allowlist (apps/api/internal/user.IsAdmin); a
// non-admin lands here and just sees the 403 message below, not a fake
// empty dashboard.
export default async function AdminMetricsPage() {
  const local = await getLocalSession();
  if (!local) redirect("/login");

  let error = "";
  const metrics = await getAdminMetrics(local.accessToken).catch((err) => {
    error =
      err instanceof ApiError && err.status === 403
        ? "You don't have access to this page."
        : err instanceof Error
          ? err.message
          : "Failed to load metrics.";
    return null;
  });

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />
      <main className="mx-auto w-full max-w-4xl flex-1 px-10 py-12 sm:px-12 lg:px-14">
        <h1 className="text-xl font-bold text-gray-900">Internal metrics</h1>
        <p className="mt-1 text-sm text-gray-500">Design doc v2 §11 — real aggregates, not projections.</p>

        {error && <p className="mt-6 text-sm text-brand-urgent">{error}</p>}

        {metrics && (
          <div className="mt-6 flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Total orders" value={metrics.totalOrders.toLocaleString()} />
              <Stat label="ACH mix" value={`${metrics.achMixPct.toFixed(1)}%`} />
              <Stat label="Orders / active seller (30d)" value={metrics.ordersPerActiveSellerLast30d.toFixed(1)} />
              <Stat label="ACH return rate" value={`${metrics.achReturnRatePct.toFixed(2)}%`} />
            </div>

            {metrics.avgHoursPurchaseToPayout != null && (
              <Stat
                label="Avg. time from purchase to payout"
                value={`${metrics.avgHoursPurchaseToPayout.toFixed(1)}h`}
              />
            )}

            <Table
              title="Tier distribution of GMV"
              rows={metrics.tierGmv}
              columns={[
                { key: "tier", label: "Tier" },
                { key: "orderCount", label: "Orders" },
                { key: "gmvCents", label: "GMV", format: formatPrice },
              ]}
            />

            <Table
              title="Realized margin by tier + rail"
              rows={metrics.marginByTierRail}
              columns={[
                { key: "tier", label: "Tier" },
                { key: "rail", label: "Rail" },
                { key: "orderCount", label: "Orders" },
                { key: "marginCents", label: "Margin", format: formatPrice },
              ]}
            />

            <Table
              title="Dispute rate by tier"
              rows={metrics.disputeRateByTier}
              columns={[
                { key: "tier", label: "Tier" },
                { key: "orderCount", label: "Orders" },
                { key: "claimCount", label: "Claims" },
                { key: "ratePct", label: "Rate", format: (v: number) => `${v.toFixed(2)}%` },
              ]}
            />

            <Table
              title="Rail mix"
              rows={metrics.railMix}
              columns={[
                { key: "rail", label: "Rail" },
                { key: "orderCount", label: "Orders" },
                { key: "gmvCents", label: "GMV", format: formatPrice },
              ]}
            />
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-brand-border bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-gray-900">{value}</p>
    </div>
  );
}

function Table<T extends Record<string, unknown>>({
  title,
  rows,
  columns,
}: {
  title: string;
  rows: T[];
  columns: { key: keyof T; label: string; format?: (v: never) => string }[];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-brand-border bg-white">
      <h2 className="border-b border-brand-border px-4 py-3 text-sm font-semibold text-gray-900">
        {title}
      </h2>
      <table className="w-full min-w-[320px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-gray-500">
          <tr>
            {columns.map((c) => (
              <th key={String(c.key)} className="px-4 py-2 font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-3 text-gray-400">
                No data yet.
              </td>
            </tr>
          )}
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-brand-border">
              {columns.map((c) => {
                const raw = row[c.key];
                const display = c.format ? c.format(raw as never) : String(raw);
                return (
                  <td key={String(c.key)} className="px-4 py-2 text-gray-700">
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
