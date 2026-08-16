import { Wallet } from "lucide-react";
import WithdrawPanel from "@/components/WithdrawPanel";
import SellerPayoutsSetup from "@/components/SellerPayoutsSetup";
import { getCurrentSession } from "@/lib/session";
import { getPayoutSummary, getSellerConnectStatus, type SellerConnectStatus } from "@/lib/api";
import { isStripeConfigured } from "@/lib/stripe";

const noConnectStatus: SellerConnectStatus = {
  hasAccount: false,
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
};

// "Withdraw" — right after "Selling" in AccountTabs, deliberately: this is
// the page a seller checks after making a sale, same instinct as checking
// a real wallet balance. Gated on Connect onboarding being complete
// (chargesEnabled) same as the Sell page's gate on listing creation —
// nothing to withdraw from without a connected account, so this shows the
// same SellerPayoutsSetup prompt instead of a wallet full of zeros.
export default async function WithdrawPage() {
  const { session } = await getCurrentSession();

  const connectStatus =
    session && isStripeConfigured()
      ? await getSellerConnectStatus(session.access_token).catch(() => noConnectStatus)
      : noConnectStatus;

  const summary =
    session && isStripeConfigured() && connectStatus.chargesEnabled
      ? await getPayoutSummary(session.access_token).catch(() => ({
          availableCents: 0,
          pendingCents: 0,
          recent: [],
        }))
      : null;

  return (
    <div className="px-10 py-8 sm:px-12 lg:px-14">
      <div className="mx-auto max-w-xl text-center">
        <h1 className="flex items-center justify-center gap-2 text-xl font-bold text-gray-900">
          <Wallet size={20} /> Withdraw
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Your available balance, what&apos;s still on hold, and your payout history.
        </p>

        {!isStripeConfigured() ? (
          <p className="mt-6 text-sm text-gray-500">Payouts aren&apos;t configured yet.</p>
        ) : summary ? (
          <WithdrawPanel initialSummary={summary} />
        ) : (
          <div className="mt-6 rounded-2xl border border-brand-border bg-white p-6 text-left shadow-sm">
            <p className="text-sm font-semibold text-gray-900">Set up payouts to withdraw</p>
            <SellerPayoutsSetup initialStatus={connectStatus} returnPath="/account/withdraw" />
          </div>
        )}
      </div>
    </div>
  );
}
