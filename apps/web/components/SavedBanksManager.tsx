"use client";

import { useEffect, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Landmark, ShieldCheck, Trash2 } from "lucide-react";
import {
  createBankSetupIntent,
  setDefaultBank,
  deleteSavedBank,
  getSavedBanksClient,
  type SavedBank,
} from "@/lib/api";
import { getStripe } from "@/lib/stripe";

// "Linked Bank Accounts" in Account Settings — the bank-account
// counterpart to SavedCardsManager, same shape and same underlying
// pattern (a lazily-created platform Stripe Customer holding saved
// PaymentMethods). A bank saved here becomes the buyer's default and is
// what "Pay by bank instead" checkout auto-attaches from then on
// (internal/paymentmethod.DefaultBank), so a returning buyer never has to
// re-link their bank through Financial Connections on every purchase.
//
// Deliberately a separate Stripe object from a seller's Connect payout
// bank account (SellerPayoutsSetup) — even for someone who's both a buyer
// and a seller with the same real-world bank, these can't be merged:
// Stripe scopes a platform Customer's saved PaymentMethod (this) and a
// connected account's payout external_account (that) completely
// differently. Linking here only ever affects what this buyer pays WITH,
// never where anyone's sale proceeds get paid OUT to.
export default function SavedBanksManager({ initialBanks }: { initialBanks: SavedBank[] }) {
  const [banks, setBanks] = useState(initialBanks);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setBanks(await getSavedBanksClient());
    } catch {
      // Best-effort — the list just stays as it was.
    }
  }

  async function handleMakeDefault(id: string) {
    setBusyId(id);
    setError("");
    try {
      await setDefaultBank(id);
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
      await deleteSavedBank(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-4">
      {banks.length === 0 && !adding && (
        <p className="text-sm text-gray-500">No linked bank accounts yet.</p>
      )}

      {banks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {banks.map((bank) => (
            <li
              key={bank.id}
              className="flex items-center justify-between rounded-lg border border-brand-border px-3 py-2 text-sm"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Landmark size={16} className="shrink-0 text-gray-400" />
                <span className="truncate font-medium text-gray-900">
                  {bank.bankName || "Bank account"} •••• {bank.last4}
                </span>
                {bank.isDefault && (
                  <span className="shrink-0 rounded-full bg-brand-success/10 px-2 py-0.5 text-[11px] font-semibold text-brand-success">
                    Default
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {!bank.isDefault && (
                  <button
                    type="button"
                    onClick={() => handleMakeDefault(bank.id)}
                    disabled={busyId === bank.id}
                    className="text-xs font-medium text-brand-navy hover:underline disabled:opacity-60"
                  >
                    Make default
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleRemove(bank.id)}
                  disabled={busyId === bank.id}
                  aria-label="Remove bank account"
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
        <AddBankForm
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
          + Link a bank account
        </button>
      )}
    </div>
  );
}

// The consent line every entry point into bank-linking shows (here and
// checkout's inline version) — the explicit "what is this and why" the
// buyer asked for: this saves the account for future purchases, and it's
// a real Stripe-hosted login, not a form that collects account/routing
// numbers directly.
export function BankLinkingConsentNotice() {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs text-gray-500">
      <ShieldCheck size={14} className="mt-0.5 shrink-0 text-brand-success" />
      You&apos;ll securely log in to your bank through Stripe — AuctionHous never sees your
      login or account details. This saves the account so you can pay with it again on future
      purchases.
    </p>
  );
}

// Exported so checkout (MockCheckout.tsx) can embed the exact same
// link-a-bank flow inline, with its own button copy and return path —
// never a second, drifted implementation of the confirmSetup logic below.
// onCancel omitted entirely hides the Cancel button, for checkout's "you
// have zero linked banks, this form IS the only path forward" case.
export function AddBankForm({
  onDone,
  onCancel,
  buttonLabel = "Link Bank Account",
  returnPath = "/account/settings",
}: {
  // Receives the newly-linked bank's payment method id — Account Settings
  // ignores it, checkout uses it to immediately charge the bank account
  // that was just linked, without a second manual step.
  onDone: (paymentMethodId?: string) => void;
  onCancel?: () => void;
  buttonLabel?: string;
  returnPath?: string;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    createBankSetupIntent()
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
      <AddBankFormInner
        onDone={onDone}
        onCancel={onCancel}
        buttonLabel={buttonLabel}
        returnPath={returnPath}
      />
    </Elements>
  );
}

function AddBankFormInner({
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
        payment_method_data: { allow_redisplay: "always" },
      },
    });

    if (confirmError) {
      setError(confirmError.message ?? "Couldn't link bank account.");
      setSubmitting(false);
      return;
    }

    const paymentMethodId =
      typeof setupIntent?.payment_method === "string"
        ? setupIntent.payment_method
        : setupIntent?.payment_method?.id;
    if (paymentMethodId) {
      try {
        await setDefaultBank(paymentMethodId);
      } catch {
        // Best-effort — the bank is still linked either way.
      }
    }
    onDone(paymentMethodId);
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-200 p-3">
      <PaymentElement options={{ wallets: { link: "never" } }} />
      <BankLinkingConsentNotice />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!stripe || submitting}
          className="rounded-full bg-brand-gold px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
        >
          {submitting ? "Linking..." : buttonLabel}
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
      <p className="mt-2 text-xs text-gray-500">
        Test mode — search &quot;Stripe Test Bank&quot; and use any login when prompted.
      </p>
    </div>
  );
}
