import { getMySales } from "@/lib/api";
import { getLocalSession } from "@/lib/session";
import PurchaseHistoryTable from "@/components/PurchaseHistoryTable";

export default async function SoldHistoryPage() {
  // app/account/layout.tsx already gates this route on a real verified
  // session, so a local cookie read for the access_token is all this page
  // needs — same reasoning as Buy History/Bids/Offers.
  const local = await getLocalSession();
  const sales = local ? await getMySales(local.accessToken) : [];

  return (
    <div className="px-10 py-8 sm:px-12 lg:px-14">
      <h1 className="text-xl font-bold text-gray-900">Sold History</h1>
      <p className="mt-1 text-sm text-gray-500">
        Everything you&apos;ve sold, whether you&apos;ve been paid for it yet or not.
      </p>
      <PurchaseHistoryTable items={sales} role="selling" />
    </div>
  );
}
