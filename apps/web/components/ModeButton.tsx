import type { LucideIcon } from "lucide-react";

// The Sold/Purchased toggle button on Transactions (TransactionsList) and
// the Active/History toggle on Selling (SellingLists) are the same visual
// pattern — pulled out once here rather than duplicated a second time.
export default function ModeButton({
  icon: Icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium transition-colors ${
        active ? "bg-brand-navy text-white" : "bg-white text-gray-600 hover:bg-brand-surface"
      }`}
    >
      <Icon size={14} />
      {label}
      <span className={active ? "text-white/70" : "text-gray-400"}>{count}</span>
    </button>
  );
}
