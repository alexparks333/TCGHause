"use client";

import { useEffect, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { CreditCard, Trash2 } from "lucide-react";
import {
  createCardSetupIntent,
  setDefaultCard,
  deleteSavedCard,
  getSavedCardsClient,
  type SavedCard,
} from "@/lib/api";
import { formatCardBrand } from "@/lib/types";
import { getStripe } from "@/lib/stripe";

// "Save a Card" in Account Settings — a card saved here becomes the buyer's
// default and is what Buy It Now checkout auto-attaches from then on
// (internal/paymentmethod.DefaultCard), so a test purchase never needs the
// card re-typed. The actual card number never reaches this component or
// our backend at all — Stripe Elements collects it directly.
export default function SavedCardsManager({ initialCards }: { initialCards: SavedCard[] }) {
  const [cards, setCards] = useState(initialCards);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setCards(await getSavedCardsClient());
    } catch {
      // Best-effort — the list just stays as it was.
    }
  }

  async function handleMakeDefault(id: string) {
    setBusyId(id);
    setError("");
    try {
      await setDefaultCard(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(id: string) {
    setBusyId(id);
    setError("");
    try {
      await deleteSavedCard(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-4">
      {cards.length === 0 && !adding && (
        <p className="text-sm text-gray-500">No saved cards yet.</p>
      )}

      {cards.length > 0 && (
        <ul className="flex flex-col gap-2">
          {cards.map((card) => (
            <li
              key={card.id}
              className="flex items-center justify-between rounded-lg border border-brand-border px-3 py-2 text-sm"
            >
              <div className="flex min-w-0 items-center gap-2">
                <CreditCard size={16} className="shrink-0 text-gray-400" />
                <span className="truncate font-medium text-gray-900">
                  {formatCardBrand(card.brand)} •••• {card.last4}
                </span>
                <span className="shrink-0 text-xs text-gray-500">
                  exp {String(card.expMonth).padStart(2, "0")}/{card.expYear}
                </span>
                {card.isDefault && (
                  <span className="shrink-0 rounded-full bg-brand-success/10 px-2 py-0.5 text-[11px] font-semibold text-brand-success">
                    Default
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {!card.isDefault && (
                  <button
                    type="button"
                    onClick={() => handleMakeDefault(card.id)}
                    disabled={busyId === card.id}
                    className="text-xs font-medium text-brand-navy hover:underline disabled:opacity-60"
                  >
                    Make default
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleRemove(card.id)}
                  disabled={busyId === card.id}
                  aria-label="Remove card"
                  className="text-gray-400 transition-colors hover:text-brand-urgent disabled:opacity-60"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-sm text-brand-urgent">{error}</p>}

      {adding ? (
        <AddCardForm
          onDone={() => {
            setAdding(false);
            refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-3 rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-brand-surface"
        >
          + Add a card
        </button>
      )}
    </div>
  );
}

// Exported so checkout (MockCheckout.tsx) can embed the exact same
// save-a-card flow inline, with its own button copy ("Save Card for
// future use") and return path — never a second, drifted implementation
// of the confirmSetup logic below. onCancel omitted entirely hides the
// Cancel button, for checkout's "you have zero saved cards, this form IS
// the only path forward" case.
export function AddCardForm({
  onDone,
  onCancel,
  buttonLabel = "Save Card",
  returnPath = "/account/settings",
}: {
  // Receives the newly-saved card's payment method id — Account Settings
  // ignores it (just closes the form and refreshes its own list), but
  // checkout (MockCheckout.tsx) uses it to immediately charge the card
  // that was just saved, without making the buyer click Pay a second time.
  onDone: (paymentMethodId?: string) => void;
  onCancel?: () => void;
  buttonLabel?: string;
  returnPath?: string;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    createCardSetupIntent()
      .then((r) => {
        if (!cancelled) setClientSecret(r.clientSecret);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't start.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) return <p className="mt-3 text-sm text-brand-urgent">{loadError}</p>;
  if (!clientSecret) return <p className="mt-3 text-sm text-gray-500">Loading...</p>;

  return (
    <Elements stripe={getStripe()} options={{ clientSecret, appearance: { theme: "stripe" } }}>
      <AddCardFormInner
        onDone={onDone}
        onCancel={onCancel}
        buttonLabel={buttonLabel}
        returnPath={returnPath}
      />
    </Elements>
  );
}

function AddCardFormInner({
  onDone,
  onCancel,
  buttonLabel,
  returnPath,
}: {
  onDone: (paymentMethodId?: string) => void;
  onCancel?: () => void;
  buttonLabel: string;
  returnPath: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError("");

    const { error: confirmError, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
      confirmParams: {
        return_url: `${window.location.origin}${returnPath}`,
        // Without this, a saved card comes back as allow_redisplay
        // "unspecified" — which is exactly why checkout's saved-card
        // display needs the widened filter in internal/payment.
        // CreateCustomerSession. Setting it explicitly here is the
        // correct fix going forward; that filter is the belt-and-
        // suspenders for cards saved before this existed.
        payment_method_data: { allow_redisplay: "always" },
      },
    });

    if (confirmError) {
      setError(confirmError.message ?? "Couldn't save card.");
      setSubmitting(false);
      return;
    }

    // A newly-saved card becomes the default — the whole point of saving
    // one is so the next checkout uses it automatically, not just that it
    // exists somewhere in a list.
    const paymentMethodId =
      typeof setupIntent?.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent?.payment_method?.id;
    if (paymentMethodId) {
      try {
        await setDefaultCard(paymentMethodId);
      } catch {
        // Best-effort — the card is still saved either way.
      }
    }
    onDone(paymentMethodId);
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-200 p-3">
      <PaymentElement options={{ wallets: { link: "never" } }} />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!stripe || submitting}
          className="rounded-full bg-brand-gold px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
        >
          {submitting ? "Saving..." : buttonLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-brand-surface"
          >
            Cancel
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-brand-urgent">{error}</p>}
      <p className="mt-2 text-xs text-gray-500">
        Test mode — use card 4242 4242 4242 4242, any future expiry, any CVC.
      </p>
    </div>
  );
}
