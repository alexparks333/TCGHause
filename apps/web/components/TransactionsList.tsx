"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock,
  Search,
  ShoppingCart,
  Tag,
  type LucideIcon,
} from "lucide-react";
import type { OrderState, OrderSummary } from "@/lib/api";
import { formatPrice } from "@/lib/types";
import { formatRelativeTime } from "@/lib/format";
import TransactionStepper from "@/components/TransactionStepper";

type Mode = "purchased" | "sold";

// The Transactions tab (account/transactions) — every order the caller is
// a participant in, buyer or seller side. Toolbar (Sold/Purchased toggle,
// search-by-card-name, Collapse Completed) and the card shape itself
// (thumbnail/title/status-badge header, a full-width stepper band
// underneath) are modeled on csfloat.com/profile/trades — see
// TransactionStepper's own doc comment for the stepper specifically.
// Deliberately client-only filtering, not URL params like the homepage's
// game/search filters (CLAUDE.md §6.14): everything here operates over one
// already-fetched list on one page, not a fresh fetch per filter change,
// so there's no round trip for a URL to usefully drive.
export default function TransactionsList({ orders }: { orders: OrderSummary[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("purchased");
  const [query, setQuery] = useState("");
  const [collapseCompleted, setCollapseCompleted] = useState(false);

  const soldCount = orders.filter((o) => o.viewerIsSeller).length;
  const purchasedCount = orders.length - soldCount;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (mode === "sold" ? !o.viewerIsSeller : o.viewerIsSeller) return false;
      if (q && !o.listingTitle.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [orders, mode, query]);

  if (orders.length === 0) {
    return (
      <p className="mt-6 text-sm text-gray-500">
        No transactions yet — they show up here once you buy or sell something.
      </p>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-brand-border">
          <ModeButton icon={Tag} label="Sold" count={soldCount} active={mode === "sold"} onClick={() => setMode("sold")} />
          <ModeButton
            icon={ShoppingCart}
            label="Purchased"
            count={purchasedCount}
            active={mode === "purchased"}
            onClick={() => setMode("purchased")}
          />
        </div>

        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by card name"
            className="w-full rounded-lg border border-brand-border py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-navy"
          />
        </div>

        <button
          type="button"
          onClick={() => setCollapseCompleted((c) => !c)}
          className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-brand-border px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-brand-surface"
        >
          {collapseCompleted ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
          {collapseCompleted ? "Expand Completed" : "Collapse Completed"}
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-500">
          {query
            ? "No transactions match that search."
            : mode === "sold"
              ? "You haven't sold anything yet."
              : "You haven't purchased anything yet."}
        </p>
      ) : (
        filtered.map((order) => {
          const href = `/order/${order.listingId}`;
          const roleLabel = order.viewerIsSeller ? "Selling to" : "Buying from";
          const amountCents = order.viewerIsSeller ? order.sellerNetCents : order.chargedCents;
          const status = statusMeta(order.state);
          const StatusIcon = status.icon;
          const isComplete = order.state === "released";
          const stepperHidden = collapseCompleted && isComplete;

          return (
            <div
              key={order.id}
              className="overflow-hidden rounded-xl border border-brand-border bg-white"
              style={{ borderLeft: `4px solid ${status.accent}` }}
            >
              <div
                onClick={() => router.push(href)}
                className="flex cursor-pointer items-center gap-4 p-4 transition-colors hover:bg-brand-surface"
              >
                {order.listingImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={order.listingImageUrl}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="h-14 w-14 shrink-0 rounded-lg bg-gradient-to-br from-brand-navy/20 to-brand-gold/20" />
                )}

                <div className="min-w-0 flex-1">
                  <Link
                    href={href}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate font-medium text-gray-900 hover:underline"
                  >
                    {order.listingTitle}
                  </Link>
                  <p className="truncate text-xs text-gray-500">
                    {roleLabel}{" "}
                    {order.counterpartyUsername ? (
                      <Link
                        href={`/seller/${order.counterpartyUsername}`}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-brand-navy hover:underline"
                      >
                        {order.counterpartyUsername}
                      </Link>
                    ) : (
                      "them"
                    )}{" "}
                    · <span className="font-semibold text-gray-700">{formatPrice(amountCents)}</span>
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="flex items-center justify-end gap-1 text-sm font-semibold" style={{ color: status.accent }}>
                    <StatusIcon size={14} />
                    {status.label}
                  </p>
                  <p className="text-xs text-gray-400">{formatRelativeTime(order.createdAt)}</p>
                </div>
              </div>

              {!stepperHidden && (
                <div className="border-t border-brand-border bg-brand-surface px-4 py-4 sm:px-6">
                  <TransactionStepper
                    sellerUsername={order.sellerUsername}
                    buyerUsername={order.buyerUsername}
                    viewerIsSeller={order.viewerIsSeller}
                    state={order.state}
                    actionHref={href}
                  />
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function ModeButton({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium transition-colors ${
        active ? "bg-brand-navy text-white" : "bg-white text-gray-600 hover:bg-brand-surface"
      }`}
    >
      <Icon size={14} />
      {label}
      <span className={active ? "text-white/70" : "text-gray-400"}>{count}</span>
    </button>
  );
}

function statusMeta(state: OrderState): { icon: LucideIcon; label: string; accent: string } {
  switch (state) {
    case "released":
      return { icon: CheckCircle2, label: "Complete", accent: "var(--color-brand-success)" };
    case "refunded":
      return { icon: AlertTriangle, label: "Refunded", accent: "var(--color-brand-urgent)" };
    case "cancelled":
      return { icon: AlertTriangle, label: "Cancelled", accent: "var(--color-brand-urgent)" };
    case "claim_open":
      return { icon: AlertTriangle, label: "Claim open", accent: "var(--color-brand-urgent)" };
    default:
      return { icon: Clock, label: "In progress", accent: "var(--color-brand-gold)" };
  }
}
