"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, PackageSearch, ShoppingBag, Store } from "lucide-react";
import ClaimPanel from "./ClaimPanel";
import { getMyOrdersMine, type OrderSummary } from "@/lib/api";
import { formatPrice } from "@/lib/types";

type Role = "buyer" | "seller";
type Step = "role" | "orders" | "sheet";

const RECENT_LIMIT = 6;

function formatOrderState(state: string): string {
  return state.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

// Animated, in-place claim intake: role -> a shortened list of the caller's
// matching recent orders (real /me/orders data, filtered client-side —
// nothing fetched twice for the buyer vs. seller view) -> the real claim
// sheet. Deliberately reuses ClaimPanel (the same component the order-status
// page already uses) rather than building a second claim form — a claim
// filed from here is identical to one filed from the order page, just
// reached without leaving Support first.
export default function ClaimStart({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [step, setStep] = useState<Step>("role");
  const [role, setRole] = useState<Role | null>(null);
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [selected, setSelected] = useState<OrderSummary | null>(null);

  async function chooseRole(r: Role) {
    setRole(r);
    setStep("orders");
    if (orders !== null) return; // already fetched once — reused for either role
    setLoadingOrders(true);
    setOrdersError("");
    try {
      setOrders(await getMyOrdersMine());
    } catch {
      setOrdersError("Couldn't load your orders. Try again in a moment.");
    } finally {
      setLoadingOrders(false);
    }
  }

  function chooseOrder(o: OrderSummary) {
    setSelected(o);
    setStep("sheet");
  }

  if (!isLoggedIn) {
    return (
      <div className="mt-6 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-brand-border">
        <p className="text-sm text-gray-600">Log in to file a claim on one of your orders.</p>
        <Link
          href="/login"
          className="mt-4 inline-block rounded-full bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-navy-light"
        >
          Log in
        </Link>
      </div>
    );
  }

  const filtered = (orders ?? []).filter((o) =>
    role === "seller" ? o.viewerIsSeller : !o.viewerIsSeller,
  );
  const shortList = filtered.slice(0, RECENT_LIMIT);

  return (
    <div className="mt-6">
      <style>{`
        @keyframes claimStepIn {
          0% { opacity: 0; transform: translateY(10px) scale(0.98); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {step === "role" && (
        <div key="role" style={{ animation: "claimStepIn 0.3s cubic-bezier(0.16,1,0.3,1) forwards" }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => chooseRole("buyer")}
              className="group flex flex-col items-center gap-3 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-brand-border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-navy/10 text-brand-navy transition-colors group-hover:bg-brand-navy group-hover:text-white">
                <ShoppingBag size={26} />
              </span>
              <span className="text-base font-bold text-gray-900">I&apos;m a Buyer</span>
              <span className="text-xs text-gray-500">Filing about something I purchased</span>
            </button>

            <button
              type="button"
              onClick={() => chooseRole("seller")}
              className="group flex flex-col items-center gap-3 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-brand-border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-navy/10 text-brand-navy transition-colors group-hover:bg-brand-navy group-hover:text-white">
                <Store size={26} />
              </span>
              <span className="text-base font-bold text-gray-900">I&apos;m a Seller</span>
              <span className="text-xs text-gray-500">Filing about something I sold</span>
            </button>
          </div>
        </div>
      )}

      {step === "orders" && role && (
        <div key="orders" style={{ animation: "claimStepIn 0.3s cubic-bezier(0.16,1,0.3,1) forwards" }}>
          <button
            type="button"
            onClick={() => setStep("role")}
            className="flex items-center gap-1 text-xs font-medium text-brand-navy hover:underline"
          >
            <ArrowLeft size={14} /> Choose a different role
          </button>

          <h2 className="mt-3 text-sm font-semibold text-gray-900">
            {role === "seller" ? "Which sale is this about?" : "Which purchase is this about?"}
          </h2>

          {loadingOrders && <p className="mt-4 text-sm text-gray-500">Loading your orders…</p>}
          {ordersError && <p className="mt-4 text-sm text-brand-urgent">{ordersError}</p>}

          {!loadingOrders && !ordersError && shortList.length === 0 && (
            <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-brand-border">
              <PackageSearch size={28} className="text-gray-300" />
              <p className="text-sm text-gray-500">
                {role === "seller" ? "You don't have any sales yet." : "You don't have any purchases yet."}
              </p>
            </div>
          )}

          <div className="mt-3 flex flex-col gap-2">
            {shortList.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => chooseOrder(o)}
                className="flex items-center gap-3 rounded-xl bg-white p-3 text-left shadow-sm ring-1 ring-brand-border transition-all hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-brand-surface">
                  {o.listingImageUrl && (
                    <Image src={o.listingImageUrl} alt="" fill className="object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">{o.listingTitle}</p>
                  <p className="text-xs text-gray-500">
                    {role === "seller" ? "Buyer" : "Seller"}: {o.counterpartyUsername ?? "—"} &middot;{" "}
                    {new Date(o.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-gray-900">{formatPrice(o.chargedCents)}</p>
                  <p className="text-[11px] text-gray-400">{formatOrderState(o.state)}</p>
                </div>
              </button>
            ))}
          </div>

          {filtered.length > 0 && (
            <Link
              href={role === "seller" ? "/account/sold-history" : "/account/buy-history"}
              className="mt-3 inline-block text-xs font-medium text-brand-navy hover:underline"
            >
              View all in {role === "seller" ? "Sold History" : "Buy History"} &rarr;
            </Link>
          )}
        </div>
      )}

      {step === "sheet" && selected && (
        <div key="sheet" style={{ animation: "claimStepIn 0.3s cubic-bezier(0.16,1,0.3,1) forwards" }}>
          <button
            type="button"
            onClick={() => setStep("orders")}
            className="flex items-center gap-1 text-xs font-medium text-brand-navy hover:underline"
          >
            <ArrowLeft size={14} /> Choose a different order
          </button>

          <div className="mt-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-brand-border">
            <div className="flex items-center gap-3">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-brand-surface">
                {selected.listingImageUrl && (
                  <Image src={selected.listingImageUrl} alt="" fill className="object-cover" />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">{selected.listingTitle}</p>
                <p className="text-xs text-gray-500">
                  {formatPrice(selected.chargedCents)} &middot; {formatOrderState(selected.state)}
                </p>
              </div>
            </div>

            <ClaimPanel
              listingId={selected.listingId}
              orderId={selected.id}
              orderState={selected.state}
              viewerIsSeller={selected.viewerIsSeller}
              notEligibleFallback={
                <div className="mt-6 border-t border-brand-border pt-5 text-sm text-gray-600">
                  {selected.viewerIsSeller ? (
                    <>
                      Only the buyer can open a claim on an order. If there&apos;s a problem with
                      this sale,{" "}
                      <Link href="/support/contact" className="text-brand-navy hover:underline">
                        contact support
                      </Link>{" "}
                      and reference this order.
                    </>
                  ) : (
                    <>
                      This order isn&apos;t eligible for a claim right now — it&apos;s either past
                      the claim window or hasn&apos;t reached it yet.{" "}
                      <Link href="/support/contact" className="text-brand-navy hover:underline">
                        Contact support
                      </Link>{" "}
                      if you think that&apos;s wrong.
                    </>
                  )}
                </div>
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
