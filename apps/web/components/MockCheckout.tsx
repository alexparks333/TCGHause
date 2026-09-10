"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { AlertTriangle, ArrowLeft, Check, CreditCard, Landmark, Mail, Package } from "lucide-react";
import {
  buyNow,
  createCheckoutIntent,
  createCardSetupIntent,
  getSavedCardsClient,
  getSavedBanksClient,
  ApiError,
  type CheckoutIntent,
  type SavedCard,
  type SavedBank,
} from "@/lib/api";
import { AddCardForm } from "@/components/SavedCardsManager";
import { AddBankForm } from "@/components/SavedBanksManager";
import ShippingAddressGate from "@/components/ShippingAddressGate";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { formatPrice, type ShippingPreset } from "@/lib/types";

// Envelope for the two letter-mechanism presets (internal/shipping's own
// Mechanism split, CLAUDE.md §6.18), a box for everything that actually
// ships as a package — a real physical distinction, not just decoration.
const SHIPPING_METHOD_ICONS: Record<ShippingPreset, typeof Mail> = {
  free_envelope: Mail,
  tracked_envelope: Mail,
  free_bubble_mailer: Package,
  free_box: Package,
  shippo_ground_advantage: Package,
};

// The actual purchase happens right here — never on the "Buy It Now" click
// that got the buyer to this page. That's what makes two buyers safely
// racing to buy the same card safe: both can be sitting on this exact page
// for the same listing, and even both authorize a real (test-mode)
// payment, without anything being reserved or taken down for either of
// them yet. Only whichever POST /listings/{id}/buy-now call reaches the
// database first actually wins the atomic compare-and-swap (CLAUDE.md
// §5.3) — that buyer's payment gets resolved, the loser's authorization
// gets released, uncharged. Falls back to a plain "Pay With PayPal (Mock)"
// button with no real payment step at all when Stripe isn't configured
// (lib/stripe.ts's isStripeConfigured), so this page works either way.
export default function MockCheckout({
  listingId,
  priceCents,
  shippingPreset,
  shippingMethod,
  shippingCostLabel,
}: {
  listingId: string;
  priceCents: number;
  // Shown right under "Item price," before the buyer has even confirmed
  // an address or a real checkout intent exists — a real seller/buyer
  // asked for this specifically: knowing the shipping method and its cost
  // up front, not only after clicking through to the payment step where
  // the real Subtotal/Shipping/Tax breakdown (OrderBreakdown, below) first
  // becomes available. Computed from the listing itself (shippingMethodLabel/
  // shippingCostLabel, lib/types.ts) — the same numbers already shown on the
  // listing detail page, so this is a preview, not a second source of truth.
  // shippingPreset is only for picking SHIPPING_METHOD_ICONS' icon.
  shippingPreset: ShippingPreset;
  shippingMethod: string;
  shippingCostLabel: string;
}) {
  const ShippingMethodIcon = SHIPPING_METHOD_ICONS[shippingPreset];

  // One breakdown block, not two. Originally "Item price"/"Shipping" lived
  // here as a preview, and a second, separate Subtotal/Shipping/Tax/Order
  // total block appeared further down once StripeCheckout had a real
  // intent — a real ask was to merge these into one fluid block instead:
  // "Item price" relabels itself to "Subtotal" and a "Sales tax" + "Order
  // total" row animate in, right in place, rather than the same numbers
  // appearing twice on the page. That means `intent` (which used to live
  // entirely inside StripeCheckout) has to be mirrored up here — StripeCheckout
  // still owns fetching it, but reports every change via onIntentChange.
  const [intent, setIntent] = useState<CheckoutIntent | null>(null);
  // Rail switches transiently null the intent while StripeCheckout fetches
  // a fresh one (its own effect) — without this, toggling "Pay by bank
  // instead" would collapse the tax/total rows shut and reopen them a
  // moment later, which reads as a glitch, not "fluid." lastIntentRef keeps
  // the last real values on screen through that gap; hasLoadedOnce (a real
  // state, unlike the ref, so it can drive the animation) latches true the
  // first time an intent ever arrives and never resets, so the rows never
  // collapse again once they've appeared.
  const lastIntentRef = useRef<CheckoutIntent | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  function handleIntentChange(next: CheckoutIntent | null) {
    setIntent(next);
    if (next) {
      lastIntentRef.current = next;
      setHasLoadedOnce(true);
    }
  }
  const displayIntent = intent ?? lastIntentRef.current;

  // Matches the listing detail page's own price/buy box exactly
  // (app/listing/[id]/page.tsx's "Buy it now"/AuctionPriceBox container:
  // rounded-xl, p-5, no shadow) — this used to be rounded-2xl/p-8/
  // shadow-sm, a visibly different, more heavily padded box for what's
  // meant to read as the same info box carried over from the listing
  // page into checkout.
  return (
    <div className="rounded-xl border border-brand-border bg-white p-5">
      {/* This card sits in a `sticky top-6` column (app/checkout/[id]/page.tsx)
          — on a long listing it stays pinned in view while the page-level
          "Back to listing" link above the two-column grid scrolls out of
          sight, so the buyer would land here with no visible way back.
          Repeating the link inside the sticky card itself fixes that. */}
      <Link
        href={`/listing/${listingId}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-brand-navy"
      >
        <ArrowLeft size={15} /> Back to listing
      </Link>
      <h1 className="text-xl font-bold text-gray-900">Complete your purchase</h1>
      {/* "Item price" before a real checkout intent exists (the only number
          known that early — see the address-confirmation gap this filled
          in, ShippingAddressGate), relabeling itself to "Subtotal" the
          instant one does — the intent's own subtotalCents, not a second
          guess at the same number. Calling this "Total" was the original
          bug: a buyer saw "Total $66.66" up top and "Pay $68.22" at the
          bottom with no visible reconciliation — the gap was real shipping
          cost, not a hidden fee, but nothing on the page said so. */}
      <div className="mt-3 flex items-center justify-between border-t border-brand-border pt-3 text-sm">
        <span className="text-gray-500">{displayIntent ? "Subtotal" : "Item price"}</span>
        <span className="text-lg font-bold text-gray-900">
          {formatPrice(displayIntent ? displayIntent.subtotalCents : priceCents)}
        </span>
      </div>
      {/* shippingCostLabel (the pre-intent preview) already reads as a full
          phrase ("+$1.56 shipping", "Free Shipping") — pairing it with an
          explicit "Shipping:" prefix would say the word twice, so the
          method name is the only label. Once a real intent exists, the
          value switches to the authoritative intent.shippingCents (same
          bare-number style the tax/total rows below use), not the preview
          string. */}
      <div className="mt-1.5 flex items-center justify-between text-sm">
        <span className="flex items-center gap-1 text-gray-400">
          <ShippingMethodIcon size={14} /> {shippingMethod}
        </span>
        <span className="text-gray-500">
          {displayIntent
            ? displayIntent.shippingCents > 0
              ? formatPrice(displayIntent.shippingCents)
              : "Free"
            : shippingCostLabel}
        </span>
      </div>

      {/* The grid-rows 0fr->1fr trick animates height smoothly without
          knowing the content's height up front (a plain max-height
          transition would need a guessed cap) — this is what makes the
          address-confirmation area below visibly slide down as tax/total
          appear, rather than jumping. hasLoadedOnce (not `intent` itself)
          drives it, so it only ever opens once, never re-collapses on a
          rail switch. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          hasLoadedOnce ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="mt-1.5 flex items-center justify-between text-sm">
            <span className="text-gray-500">Sales tax</span>
            <span className="text-gray-500">{formatPrice(displayIntent?.taxCents ?? 0)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-brand-border pt-2 text-sm">
            <span className="font-semibold text-gray-900">Order total</span>
            <span className="text-lg font-bold text-gray-900">
              {formatPrice(displayIntent?.amountCents ?? 0)}
            </span>
          </div>
        </div>
      </div>

      <ShippingAddressGate>
        {isStripeConfigured() ? (
          <StripeCheckout listingId={listingId} onIntentChange={handleIntentChange} />
        ) : (
          <PlainMockCheckout listingId={listingId} />
        )}
      </ShippingAddressGate>
    </div>
  );
}

function AlreadyPurchasedNotice() {
  return (
    <div className="mt-6 flex items-start gap-2 rounded-lg bg-brand-urgent/10 p-4 text-sm font-semibold text-brand-urgent">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div>
        This Card has Already Been Purchased!
        <p className="mt-1 text-xs font-normal text-brand-urgent/80">
          Someone else completed their purchase first — this listing is no longer available.
        </p>
      </div>
    </div>
  );
}

// No Stripe configured — the original mock path, unchanged: one click, no
// card, straight to the same atomic backend purchase.
function PlainMockCheckout({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [alreadyPurchased, setAlreadyPurchased] = useState(false);

  async function handlePay() {
    setProcessing(true);
    setError("");
    try {
      await buyNow(listingId);
      router.push(`/order/${listingId}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setAlreadyPurchased(true);
      } else if (err instanceof ApiError && err.status === 403) {
        setError("You can't buy your own listing.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
      setProcessing(false);
    }
  }

  if (alreadyPurchased) return <AlreadyPurchasedNotice />;

  return (
    <>
      <button
        type="button"
        onClick={handlePay}
        disabled={processing}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[#0070ba] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[#005ea6] disabled:opacity-60"
      >
        {processing ? "Processing payment..." : "Pay With PayPal (Mock)"}
      </button>
      {error && <p className="mt-3 text-sm text-brand-urgent">{error}</p>}
      <p className="mt-3 text-center text-xs text-gray-500">
        This is a mock payment for testing — no real money moves.
      </p>
    </>
  );
}

// --- Shared "confirm, then complete the atomic purchase" logic ---
//
// Two different ways a PaymentIntent gets confirmed here: brand-new
// details typed into a Payment Element (needs `elements`, calls
// stripe.confirmPayment), or an already-attached saved card/bank with
// nothing left to collect (no Element needed at all — stripe.
// confirmCardPayment/confirmUsBankAccountPayment work from just a
// clientSecret, per their own docs: "if you have already attached a
// PaymentMethod you can call this method without needing to provide any
// additional data"). Both paths converge here once they have a confirmed
// paymentIntent id — this is the actual race (CLAUDE.md §5.3): whichever
// buyer's buyNow call below commits first wins, the other gets 409 and
// their payment released/cancelled, never charged.
interface PurchaseCallbacks {
  onAlreadyPurchased: () => void;
  onError: (message: string) => void;
  onSuccess: () => void;
}

async function finalizePurchase(listingId: string, paymentIntentId: string, cb: PurchaseCallbacks) {
  try {
    await buyNow(listingId, paymentIntentId);
    cb.onSuccess();
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      cb.onAlreadyPurchased();
    } else if (err instanceof ApiError && err.status === 403) {
      cb.onError("You can't buy your own listing.");
    } else {
      cb.onError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }
}

// Confirms clientSecret using whatever payment method is ALREADY attached
// to it server-side (a saved card/bank the buyer picked, or just saved) —
// no Payment Element, no re-entering anything. rail decides which of
// Stripe's per-method confirm calls applies (card vs us_bank_account);
// there's no unified "confirm without elements" method that covers both.
async function confirmAndBuy(
  listingId: string,
  rail: "card" | "ach",
  clientSecret: string,
  cb: PurchaseCallbacks,
) {
  const stripe = await getStripe();
  if (!stripe) {
    cb.onError("Stripe failed to load.");
    return;
  }
  const { error: confirmError, paymentIntent } =
    rail === "card"
      ? await stripe.confirmCardPayment(clientSecret)
      : await stripe.confirmUsBankAccountPayment(clientSecret);

  if (confirmError) {
    cb.onError(confirmError.message ?? "Payment failed.");
    return;
  }
  if (!paymentIntent) {
    cb.onError("Payment did not complete.");
    return;
  }
  await finalizePurchase(listingId, paymentIntent.id, cb);
}

// Stripe configured — a rail selector (card, the default/listed price, vs.
// bank, offered purely as a savings choice — design doc v2 §2.7: never
// lead with the bank price, never call the difference a "fee") sitting
// above a saved-method picker (SavedMethodPicker) and, once a method is
// chosen (or a brand new one entered), whatever's needed to confirm the
// charge. Fetches its own client secret purely to authorize a payment —
// this alone never reserves or touches the listing, so loading this page
// (or even authorizing and abandoning it) has no effect on it.
//
// Two independent fetches drive this, in sequence:
//   1. The buyer's saved cards/banks for whichever rail is selected
//      (getSavedCardsClient/getSavedBanksClient) — this app's own picker
//      UI, not Stripe's built-in "browse saved methods" Payment Element
//      carousel, which isn't available on a connected-account direct
//      charge (see payment.ClonePaymentMethodToConnectedAccount's doc
//      comment). Zero saved methods skips straight to the inline "enter a
//      new one" form — there's nothing to pick from yet.
//   2. The checkout PaymentIntent itself — scoped to whichever method is
//      selected (or the default) when the buyer isn't entering a new one,
//      or scoped to NO payment method at all while they are (adding=true
//      always fetches with paymentMethodId omitted, regardless of what
//      was selected before — a fresh, unattached intent is what a
//      brand-new, not-saved card needs to type straight into). Re-fetched
//      whenever rail or the selection changes, same lazy-per-selection
//      pattern the rail switch already used.
function StripeCheckout({
  listingId,
  onIntentChange,
}: {
  listingId: string;
  // Mirrors this component's own intent state up to MockCheckout, which
  // merges it into the single Subtotal/Shipping/Tax/Order total block at
  // the top of the page instead of rendering a second copy of the same
  // numbers down here (see MockCheckout's own comment on why).
  onIntentChange: (intent: CheckoutIntent | null) => void;
}) {
  const router = useRouter();
  const [rail, setRail] = useState<"card" | "ach">("card");
  const [methods, setMethods] = useState<(SavedCard | SavedBank)[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [intent, setIntentState] = useState<CheckoutIntent | null>(null);
  const setIntent = (next: CheckoutIntent | null) => {
    setIntentState(next);
    onIntentChange(next);
  };
  const [loadError, setLoadError] = useState("");
  const [chargeError, setChargeError] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [alreadyPurchased, setAlreadyPurchased] = useState(false);

  // Load the saved-method list for whichever rail is active. A brand new
  // rail always starts from scratch — no selection, no stale intent, and
  // (if there's nothing saved for it) straight into the "add a new one"
  // form, since there's nothing else to show.
  useEffect(() => {
    let cancelled = false;
    setMethods(null);
    setSelectedId(undefined);
    setIntent(null);
    setAdding(false);
    setChargeError("");
    const fetchMethods = rail === "card" ? getSavedCardsClient : getSavedBanksClient;
    fetchMethods()
      .then((list) => {
        if (cancelled) return;
        setMethods(list);
        setSelectedId(list.find((m) => m.isDefault)?.id);
        if (list.length === 0) setAdding(true);
      })
      .catch(() => {
        // Best-effort — proceed as if the buyer has nothing saved rather
        // than blocking checkout entirely over a list-fetch hiccup.
        if (!cancelled) {
          setMethods([]);
          setAdding(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [rail]);

  // Authorize the PaymentIntent once the method list is known: scoped to
  // the buyer's selection normally, or to nothing at all while they're
  // entering a brand-new method (adding) — see this component's doc
  // comment above for why "adding" always means "no pre-attached method,"
  // never the previously-selected one.
  useEffect(() => {
    if (methods === null) return;
    let cancelled = false;
    setIntent(null);
    createCheckoutIntent(listingId, rail, adding ? undefined : selectedId)
      .then((data) => {
        if (!cancelled) setIntent(data);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 409) {
          setAlreadyPurchased(true);
        } else if (err instanceof ApiError && err.status === 403) {
          setLoadError("You can't buy your own listing.");
        } else if (err instanceof ApiError && err.status === 412) {
          // The seller hasn't finished Stripe Connect onboarding
          // (design doc v2 §5.1) — a genuinely different condition from
          // "already sold," which is why the backend uses a distinct
          // status code (412, not 409) for it.
          setLoadError("This seller hasn't finished setting up payouts yet. Check back soon.");
        } else {
          setLoadError(err instanceof Error ? err.message : "Couldn't start checkout.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [listingId, rail, selectedId, adding, methods]);

  // After the buyer saves a brand-new card/bank inline (AddCardForm/
  // AddBankForm's onDone, which hands back the id it just saved), finish
  // the purchase with it immediately — a fresh PaymentIntent scoped to
  // that exact id, confirmed with no further UI (confirmAndBuy), so
  // "save this" and "pay with it" are one click, not two. This is what
  // fixes the empty-Payment-Element bug: the buyer never sees a second,
  // blank card form for something they just entered.
  async function handleSavedThenCharge(paymentMethodId?: string) {
    if (!paymentMethodId) {
      setChargeError("Couldn't save that — please try again.");
      return;
    }
    setFinishing(true);
    setChargeError("");
    try {
      const newIntent = await createCheckoutIntent(listingId, rail, paymentMethodId);
      await confirmAndBuy(listingId, rail, newIntent.clientSecret, {
        onAlreadyPurchased: () => setAlreadyPurchased(true),
        onError: (m) => {
          setChargeError(m);
          setFinishing(false);
        },
        onSuccess: () => router.push(`/order/${listingId}`),
      });
    } catch (err) {
      setChargeError(err instanceof Error ? err.message : "Something went wrong.");
      setFinishing(false);
    }
  }

  if (alreadyPurchased) return <AlreadyPurchasedNotice />;
  if (loadError) return <p className="mt-6 text-sm text-brand-urgent">{loadError}</p>;
  if (finishing) return <p className="mt-6 text-sm text-gray-500">Finishing your purchase...</p>;

  return (
    <>
      {intent && (
        <RailSelector
          rail={rail}
          onChange={setRail}
          cardAmountCents={intent.cardAmountCents}
          bankAmountCents={intent.bankAmountCents}
          realizedSavingCents={intent.realizedSavingCents}
        />
      )}

      {methods !== null && methods.length > 0 && !adding && (
        <SavedMethodPicker
          rail={rail}
          methods={methods}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onAddNew={() => setAdding(true)}
        />
      )}

      {adding && rail === "card" && (
        <NewCardForm
          listingId={listingId}
          baseIntent={intent}
          onSaved={handleSavedThenCharge}
          onCancel={methods && methods.length > 0 ? () => setAdding(false) : undefined}
        />
      )}
      {adding && rail === "ach" && (
        <AddBankForm
          buttonLabel={intent ? `Link Bank Account & Pay ${formatPrice(intent.amountCents)}` : "Link Bank Account"}
          returnPath={`/checkout/${listingId}`}
          onDone={handleSavedThenCharge}
          onCancel={methods && methods.length > 0 ? () => setAdding(false) : undefined}
        />
      )}
      {chargeError && <p className="mt-3 text-sm text-brand-urgent">{chargeError}</p>}

      {!adding && !intent && methods !== null && (
        <p className="mt-6 text-sm text-gray-500">Preparing checkout...</p>
      )}
      {!adding && intent && (
        <SavedMethodPayButton listingId={listingId} intent={intent} />
      )}
    </>
  );
}

// The rail choice itself — card is always shown as the plain total (the
// listed price, per §2.7), bank framed strictly as a savings offer next to
// it. Never the words "fee" or "surcharge" anywhere near the difference.
function RailSelector({
  rail,
  onChange,
  cardAmountCents,
  bankAmountCents,
  realizedSavingCents,
}: {
  rail: "card" | "ach";
  onChange: (rail: "card" | "ach") => void;
  cardAmountCents: number;
  bankAmountCents: number;
  realizedSavingCents: number;
}) {
  return (
    <div className="mt-6 flex flex-col gap-2 sm:flex-row">
      <button
        type="button"
        onClick={() => onChange("card")}
        className={`flex-1 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
          rail === "card"
            ? "border-brand-navy bg-brand-navy/5"
            : "border-brand-border hover:border-brand-navy/40"
        }`}
      >
        <span className="block font-semibold text-gray-900">Pay by card</span>
        <span className="text-gray-500">{formatPrice(cardAmountCents)}</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("ach")}
        className={`flex-1 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
          rail === "ach"
            ? "border-brand-navy bg-brand-navy/5"
            : "border-brand-border hover:border-brand-navy/40"
        }`}
      >
        <span className="flex items-center gap-1 font-semibold text-gray-900">
          <Landmark size={14} /> Pay by bank instead
        </span>
        <span className="text-brand-success">
          {formatPrice(bankAmountCents)} — save {formatPrice(realizedSavingCents)}
        </span>
      </button>
    </div>
  );
}

// The buyer's own saved cards/linked banks for the active rail, as a
// compact tile list — this app's own picker, standing in for the "browse
// every saved method" carousel Stripe's Payment Element would normally
// show, which isn't available here because the actual charge is a direct
// charge on the SELLER's connected account (see StripeCheckout's doc
// comment above). Default is pre-selected on first load; picking a
// different one re-authorizes the PaymentIntent against that method
// instead (StripeCheckout's intent effect). Managing the list itself
// (renaming, removing, changing the default outside of checkout) stays in
// Account Settings only — this is just "which one for this purchase."
function SavedMethodPicker({
  rail,
  methods,
  selectedId,
  onSelect,
  onAddNew,
}: {
  rail: "card" | "ach";
  methods: (SavedCard | SavedBank)[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onAddNew: () => void;
}) {
  return (
    <div className="mt-6">
      <ul className="flex flex-col gap-2">
        {methods.map((m) => {
          const selected = m.id === selectedId;
          const label =
            rail === "card"
              ? `${(m as SavedCard).brand ? capitalize((m as SavedCard).brand) : "Card"} •••• ${m.last4}`
              : `${(m as SavedBank).bankName || "Bank account"} •••• ${m.last4}`;
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onSelect(m.id)}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                  selected
                    ? "border-brand-navy bg-brand-navy/5"
                    : "border-brand-border hover:border-brand-navy/40"
                }`}
              >
                {rail === "card" ? (
                  <CreditCard size={16} className="shrink-0 text-gray-400" />
                ) : (
                  <Landmark size={16} className="shrink-0 text-gray-400" />
                )}
                <span className="flex-1 truncate font-medium text-gray-900">{label}</span>
                {m.isDefault && (
                  <span className="shrink-0 rounded-full bg-brand-success/10 px-2 py-0.5 text-[11px] font-semibold text-brand-success">
                    Default
                  </span>
                )}
                {selected && <Check size={16} className="shrink-0 text-brand-navy" />}
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onAddNew}
        className="mt-2 text-xs font-medium text-brand-navy hover:underline"
      >
        + {rail === "card" ? "Use a different card" : "Link a different bank account"}
      </button>
    </div>
  );
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

// The buyer already picked (or defaulted to) a saved card/bank — intent's
// PaymentIntent has it pre-attached server-side already (StripeCheckout's
// intent effect), so there's nothing left to collect and no Payment
// Element to mount at all. Showing one here was the actual bug: an empty
// card form the buyer had no reason to fill in, since the card they meant
// to use was already attached — "Your card number is incomplete" for a
// card that was never supposed to be re-typed. confirmAndBuy confirms
// straight off the attached method instead.
function SavedMethodPayButton({ listingId, intent }: { listingId: string; intent: CheckoutIntent }) {
  const router = useRouter();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [alreadyPurchased, setAlreadyPurchased] = useState(false);

  async function handlePay() {
    setProcessing(true);
    setError("");
    await confirmAndBuy(listingId, intent.rail, intent.clientSecret, {
      onAlreadyPurchased: () => setAlreadyPurchased(true),
      onError: (m) => {
        setError(m);
        setProcessing(false);
      },
      onSuccess: () => router.push(`/order/${listingId}`),
    });
  }

  if (alreadyPurchased) return <AlreadyPurchasedNotice />;

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={handlePay}
        disabled={processing}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-gold px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
      >
        {processing ? "Processing payment..." : `Pay ${formatPrice(intent.amountCents)} (Stripe Test)`}
      </button>
      {error && <p className="mt-3 text-sm text-brand-urgent">{error}</p>}
      <p className="mt-3 text-center text-xs text-gray-500">Test mode — no real money moves.</p>
    </div>
  );
}

// The card rail's "enter a new one" form — the ONLY place the "Save
// Credit Card for future use" checkbox lives, because it's the one point
// that decides which of two entirely different Stripe flows applies:
//
//   Checked   -> the card must be typed against the PLATFORM Stripe
//                account (a SetupIntent, AddCardForm reused as-is) so it
//                can be saved to the buyer's account-wide profile and
//                reused on a future purchase from ANY seller — a card
//                typed directly on a connected account (the unchecked
//                path below) cannot be cloned back to the platform later,
//                Stripe only allows platform -> connected, never the
//                reverse (see payment.ClonePaymentMethodToConnectedAccount's
//                doc comment). onSaved (StripeCheckout's
//                handleSavedThenCharge) takes it from there: fetch a
//                fresh intent for the new card, confirm, buy — no second
//                "please enter your card again" step.
//   Unchecked -> the card is typed directly against THIS checkout's own
//                connected-account PaymentIntent (baseIntent, fetched
//                with no payment method pre-attached while adding=true)
//                and never saved anywhere — the original single-step
//                "type a card, pay once" flow, unchanged.
//
// Toggling the checkbox remounts the Elements tree (key=saveForFuture)
// since it's genuinely a different Stripe account context underneath,
// not just a different UI state.
function NewCardForm({
  listingId,
  baseIntent,
  onSaved,
  onCancel,
}: {
  listingId: string;
  baseIntent: CheckoutIntent | null;
  onSaved: (paymentMethodId?: string) => void;
  // Threaded into both branches below (AddCardForm already supported this;
  // StripePaymentForm didn't). Omitted entirely when there's nothing saved
  // to go back to (StripeCheckout's own call site), same as AddBankForm's
  // existing pattern — a real gap this fixes: clicking "Use a different
  // card" used to be one-way, with no way back to the saved-card picker
  // short of a full page reload, even though the bank rail already had
  // this exact affordance.
  onCancel?: () => void;
}) {
  const [saveForFuture, setSaveForFuture] = useState(true);
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    if (!saveForFuture) return;
    let cancelled = false;
    setSetupSecret(null);
    setSetupError("");
    createCardSetupIntent()
      .then((r) => {
        if (!cancelled) setSetupSecret(r.clientSecret);
      })
      .catch((err) => {
        if (!cancelled) setSetupError(err instanceof Error ? err.message : "Couldn't start.");
      });
    return () => {
      cancelled = true;
    };
  }, [saveForFuture]);

  return (
    <div className="mt-6">
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={saveForFuture}
          onChange={(e) => setSaveForFuture(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-brand-navy focus:ring-brand-navy"
        />
        Save Credit Card for future use
      </label>

      {saveForFuture ? (
        setupError ? (
          <p className="mt-3 text-sm text-brand-urgent">{setupError}</p>
        ) : !setupSecret ? (
          <p className="mt-3 text-sm text-gray-500">Loading...</p>
        ) : (
          <Elements
            key="setup"
            stripe={getStripe()}
            options={{ clientSecret: setupSecret, appearance: { theme: "stripe" } }}
          >
            <AddCardForm
              buttonLabel={baseIntent ? `Save Card & Pay ${formatPrice(baseIntent.amountCents)}` : "Save Card"}
              returnPath={`/checkout/${listingId}`}
              onDone={onSaved}
              onCancel={onCancel}
            />
          </Elements>
        )
      ) : !baseIntent ? (
        <p className="mt-3 text-sm text-gray-500">Preparing checkout...</p>
      ) : (
        <Elements
          key="charge"
          stripe={getStripe()}
          options={{ clientSecret: baseIntent.clientSecret, appearance: { theme: "stripe" } }}
        >
          <StripePaymentForm listingId={listingId} intent={baseIntent} onCancel={onCancel} />
        </Elements>
      )}
    </div>
  );
}

function StripePaymentForm({
  listingId,
  intent,
  onCancel,
}: {
  listingId: string;
  intent: CheckoutIntent;
  onCancel?: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [alreadyPurchased, setAlreadyPurchased] = useState(false);

  async function handlePay() {
    if (!stripe || !elements) return;
    setProcessing(true);
    setError("");

    // Uses whatever the buyer currently has typed into the Payment
    // Element. Card rail: capture_method is "manual" server-side
    // (internal/payment), so this confirms the hold but never charges it.
    // Bank rail: there's no manual-capture equivalent for ACH — this
    // confirm is what actually submits the debit for processing (up to 4
    // business days, design doc v2 §4), which is why buy-now below has to
    // resolve immediately after this, not wait for a later "capture" step.
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: {
        return_url: `${window.location.origin}/checkout/${listingId}`,
      },
    });

    if (confirmError) {
      setError(confirmError.message ?? "Payment failed.");
      setProcessing(false);
      return;
    }
    if (!paymentIntent) {
      setError("Payment did not complete.");
      setProcessing(false);
      return;
    }

    await finalizePurchase(listingId, paymentIntent.id, {
      onAlreadyPurchased: () => setAlreadyPurchased(true),
      onError: (m) => {
        setError(m);
        setProcessing(false);
      },
      onSuccess: () => router.push(`/order/${listingId}`),
    });
  }

  if (alreadyPurchased) return <AlreadyPurchasedNotice />;

  return (
    <div>
      {/* wallets.link: 'never' on BOTH rails — Stripe's Link surfaces
          extra payment methods (a linked bank account under "Pay by
          card"; Klarna under "Pay by bank instead") for any browser
          that's previously used Link, REGARDLESS of this intent's
          payment_method_types already being pinned to exactly one type
          per rail (CreateIntent/CreateAchIntent's doc comments) — Link
          ignores that restriction for its own UI. Confusing either way:
          the buyer picks one specific rail and gets offered something
          else entirely. Each rail's Payment Element should only ever
          show the one payment method its own intent actually created. */}
      <PaymentElement options={{ wallets: { link: "never" } }} />
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={handlePay}
          disabled={!stripe || processing}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-gold px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
        >
          {processing ? "Processing payment..." : `Pay ${formatPrice(intent.amountCents)} (Stripe Test)`}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={processing}
            className="rounded-lg border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-brand-surface disabled:opacity-60"
          >
            Cancel
          </button>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-brand-urgent">{error}</p>}
      <p className="mt-3 text-center text-xs text-gray-500">
        {intent.rail === "ach"
          ? "Test mode — Stripe's test bank flow links instantly, no real money moves."
          : "Test mode — a new card uses 4242 4242 4242 4242, any future expiry, any CVC. No real money moves."}
      </p>
    </div>
  );
}
