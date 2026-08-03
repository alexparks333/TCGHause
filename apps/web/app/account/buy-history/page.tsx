import { myBuyHistory } from "@/lib/mock-account";
import HistoryTable from "@/components/HistoryTable";

export default function BuyHistoryPage() {
  return (
    <div className="px-10 py-8 sm:px-12 lg:px-14">
      <h1 className="text-xl font-bold text-gray-900">Buy History</h1>
      <p className="mt-1 text-sm text-gray-500">Items you've purchased.</p>
      <HistoryTable items={myBuyHistory} counterpartyLabel="Seller" />
    </div>
  );
}
