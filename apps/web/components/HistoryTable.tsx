import type { HistoryItem } from "@/lib/mock-account";
import { formatPrice } from "@/lib/types";

export default function HistoryTable({
  items,
  counterpartyLabel,
}: {
  items: HistoryItem[];
  counterpartyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="mt-6 text-sm text-gray-500">Nothing here yet.</p>;
  }

  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-brand-border bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-brand-border bg-brand-surface text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="px-4 py-3 font-medium">Item</th>
            <th className="px-4 py-3 font-medium">Price</th>
            <th className="px-4 py-3 font-medium">{counterpartyLabel}</th>
            <th className="px-4 py-3 font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.title}-${item.date}`} className="border-b border-brand-border last:border-0">
              <td className="px-4 py-3">
                <p className="font-medium text-gray-900">{item.title}</p>
                <p className="text-xs text-gray-500">
                  {item.game} · {item.set}
                </p>
              </td>
              <td className="px-4 py-3 font-semibold text-gray-900">
                {formatPrice(item.priceCents)}
              </td>
              <td className="px-4 py-3 text-gray-600">{item.counterpartyName}</td>
              <td className="px-4 py-3 text-gray-500">
                {new Date(item.date).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
