"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileDown, Loader2, RefreshCw } from "lucide-react";
import { buyShippingLabel, downloadShippingLabel, type ShippingLabel } from "@/lib/api";

// Shared between the order-status page (OrderStatusPanel) and the
// Transactions list rows (TransactionsList) — the one place a seller goes
// once a label already exists, either to grab the PDF again or to replace
// it with a fresh purchase. Deliberately a dropdown, not two standalone
// buttons: "Change Shipping Label" is a real (test-mode) re-purchase, not
// something to put one accidental click away from the primary action.
export default function PrintLabelButton({
  listingId,
  onLabelChanged,
  className,
}: {
  listingId: string;
  onLabelChanged?: (label: ShippingLabel) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleDownload() {
    setDownloading(true);
    setError("");
    try {
      await downloadShippingLabel(listingId);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't download the label.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleChange() {
    setChanging(true);
    setError("");
    try {
      const label = await buyShippingLabel(listingId);
      onLabelChanged?.(label);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't buy a new label.");
    } finally {
      setChanging(false);
    }
  }

  return (
    <div ref={rootRef} className={`relative inline-block ${className ?? ""}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-brand-navy px-3 py-1.5 text-xs font-semibold text-brand-navy transition-colors hover:bg-brand-navy/5"
      >
        <FileDown size={13} /> Download Shipping Label
        <ChevronDown size={13} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-brand-border bg-white p-1 shadow-lg"
        >
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-brand-surface disabled:opacity-60"
          >
            {downloading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <FileDown size={14} />
            )}
            {downloading ? "Downloading..." : "Download PDF"}
          </button>
          <button
            type="button"
            onClick={handleChange}
            disabled={changing}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-brand-surface disabled:opacity-60"
          >
            <RefreshCw size={14} className={changing ? "animate-spin" : ""} />
            {changing ? "Buying new label..." : "Change Shipping Label"}
          </button>
          {error && <p className="px-3 pb-1.5 text-[11px] text-brand-urgent">{error}</p>}
        </div>
      )}
    </div>
  );
}
