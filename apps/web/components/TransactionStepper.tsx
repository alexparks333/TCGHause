import Link from "next/link";
import { Check, MoreHorizontal } from "lucide-react";
import Avatar from "./Avatar";
import type { OrderState } from "@/lib/api";
import { ORDER_OFF_PATH_LABELS, ORDER_STEPS } from "@/lib/orderSteps";

// The Transactions list's per-row progress stepper — modeled directly on
// csfloat.com/profile/trades' trade-completion row (seller avatar on the
// left, buyer avatar on the right, a connected line of checkpoint bubbles
// between them), translated to this app's light theme and its own real
// order lifecycle (ORDER_STEPS) instead of a fixed 4-step trade ladder.
// Seller/Buyer are always shown in that fixed left-to-right order —
// unlike TransactionsList's "Buying from X"/"Selling to X" header line
// (viewer-relative), this row is role-relative, with the viewer's own side
// called out via the "You" tag instead of reordering the row per viewer.
export default function TransactionStepper({
  sellerUsername,
  buyerUsername,
  viewerIsSeller,
  state,
  actionHref,
}: {
  sellerUsername?: string;
  buyerUsername?: string;
  viewerIsSeller: boolean;
  state: OrderState;
  // Where the "Awaiting shipment" step goes when it's clickable — only
  // wired up for the seller, and only on that one step, since it's the
  // only step with something actionable behind it (buying a shipping
  // label). Replaces a separate "Ship Now" button per the product call:
  // the step itself IS the button.
  actionHref?: string;
}) {
  const offPath = ORDER_OFF_PATH_LABELS[state];
  const currentIndex = ORDER_STEPS.findIndex((s) => s.state === state);

  return (
    <div className="flex items-center gap-1 overflow-x-auto px-1 py-2">
      <PartyEndpoint role="Seller" username={sellerUsername} isViewer={viewerIsSeller} />

      {offPath ? (
        <>
          <Connector done={false} tone="urgent" />
          <div className="shrink-0 rounded-full bg-brand-urgent/10 px-4 py-2 text-xs font-semibold text-brand-urgent">
            {offPath}
          </div>
          <Connector done={false} tone="urgent" />
        </>
      ) : (
        ORDER_STEPS.map((step, i) => {
          const done = currentIndex >= 0 && i < currentIndex;
          const isCurrent = i === currentIndex;
          const reached = currentIndex >= 0 && i <= currentIndex;
          const clickable =
            isCurrent && viewerIsSeller && step.state === "awaiting_ship" && Boolean(actionHref);

          const bubble = (
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform duration-150 sm:h-9 sm:w-9 ${
                clickable ? "group-hover:scale-110" : ""
              } ${
                done
                  ? "bg-brand-navy text-white"
                  : isCurrent
                    ? "bg-brand-gold text-white ring-4 ring-brand-gold/20"
                    : "bg-gray-200 text-transparent"
              }`}
            >
              {done && <Check size={16} strokeWidth={3} />}
              {isCurrent && <MoreHorizontal size={18} strokeWidth={3} />}
            </span>
          );
          const labelText = (
            <span
              className={`text-center text-[11px] leading-tight ${
                reached ? "font-medium text-gray-900" : "text-gray-400"
              }`}
            >
              {step.label}
            </span>
          );

          return (
            <div key={step.state} className="flex items-center">
              <Connector done={i === 0 ? reached : currentIndex >= 0 && i - 1 < currentIndex} />
              {clickable ? (
                <Link
                  href={actionHref!}
                  className="group flex w-20 shrink-0 flex-col items-center gap-1.5 sm:w-24"
                >
                  {bubble}
                  {labelText}
                </Link>
              ) : (
                <div className="flex w-20 shrink-0 flex-col items-center gap-1.5 sm:w-24">
                  {bubble}
                  {labelText}
                </div>
              )}
            </div>
          );
        })
      )}

      <Connector done={!offPath && currentIndex === ORDER_STEPS.length - 1} tone={offPath ? "urgent" : "default"} />
      <PartyEndpoint role="Buyer" username={buyerUsername} isViewer={!viewerIsSeller} />
    </div>
  );
}

function Connector({ done, tone = "default" }: { done: boolean; tone?: "default" | "urgent" }) {
  const color = done ? (tone === "urgent" ? "bg-brand-urgent" : "bg-brand-navy") : "bg-gray-200";
  return <span className={`h-0.5 w-6 shrink-0 sm:w-9 ${color}`} />;
}

function PartyEndpoint({
  role,
  username,
  isViewer,
}: {
  role: "Seller" | "Buyer";
  username?: string;
  isViewer: boolean;
}) {
  return (
    <div className="flex w-16 shrink-0 flex-col items-center gap-1.5 sm:w-20">
      <span className={isViewer ? "rounded-full ring-2 ring-brand-gold ring-offset-2" : ""}>
        <Avatar label={username ?? role} size={40} />
      </span>
      <span className="text-center text-[11px] leading-tight text-gray-500">
        {role}
        {isViewer && <span className="block font-semibold text-brand-navy">You</span>}
      </span>
    </div>
  );
}
