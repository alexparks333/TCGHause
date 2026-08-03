import type { Listing } from "@/lib/types";

export default function ItemSpecifics({ listing }: { listing: Listing }) {
  const rows: Array<[string, string]> = [
    ["Game", listing.game],
    ["Set", listing.set],
  ];
  if (listing.cardNumber) rows.push(["Card Number", listing.cardNumber]);
  if (listing.rarity) rows.push(["Rarity", listing.rarity]);

  if (listing.isGraded) {
    if (listing.gradingCompany) rows.push(["Grading Company", listing.gradingCompany]);
    if (listing.grade) rows.push(["Grade", listing.grade]);
    if (listing.certNumber) rows.push(["Cert Number", listing.certNumber]);
  } else {
    rows.push(["Condition", listing.condition]);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-brand-border">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([key, value], i) => (
            <tr key={key} className={i % 2 === 0 ? "bg-white" : "bg-brand-surface"}>
              <th className="w-40 px-4 py-2.5 text-left font-medium text-gray-500">
                {key}
              </th>
              <td className="px-4 py-2.5 text-gray-900">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
