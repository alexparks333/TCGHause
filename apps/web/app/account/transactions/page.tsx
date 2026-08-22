import { getMyOrders } from "@/lib/api";
import { getLocalSession } from "@/lib/session";
import TransactionsList from "@/components/TransactionsList";

// The persistent order-tracking view neither Sold History/Buy History (no
// state, just paid/unpaid) nor the one-off post-checkout order-status page
// (/order/[id], not linked from anywhere once you navigate away) could
// answer: "where is this specific sale/purchase right now." Merges buying
// and selling into one list — TransactionsList's bubbles + counterparty
// label make which side you're on clear per row.
export default async function TransactionsPage() {
  const local = await getLocalSession();
  const orders = local ? await getMyOrders(local.accessToken) : [];

  return (
    <div className="px-10 py-8 sm:px-12 lg:px-14">
      <h1 className="text-xl font-bold text-gray-900">Transactions</h1>
      <p className="mt-1 text-sm text-gray-500">
        Track every purchase and sale from payment through delivery, whichever side you&apos;re on.
      </p>
      <TransactionsList orders={orders} />
    </div>
  );
}
