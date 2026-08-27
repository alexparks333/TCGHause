"use client";

import { useState, type FormEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { submitBuyerReview, type BuyerReview, type BuyerReviewTag } from "@/lib/api";

const TAGS: { value: BuyerReviewTag; label: string }[] = [
  { value: "trustworthy", label: "Trustworthy" },
  { value: "suspicious", label: "Suspicious" },
  { value: "aggressive", label: "Aggressive" },
];

const STAR_SIZE = 22;

// Quarter-star fill for one star slot (index 0-4) — reads how much of this
// particular star is filled (0 to 1) off the overall rating and clips a
// solid gold star over a gray outline to that width, rather than only ever
// being able to render a whole star on or off.
function StarSlot({ fill, size }: { fill: number; size: number }) {
  const pct = Math.max(0, Math.min(1, fill)) * 100;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <Star size={size} className="absolute inset-0 text-brand-border" />
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
        <Star size={size} className="fill-brand-gold text-brand-gold" />
      </div>
    </div>
  );
}

// Mirrors internal/buyerreview's validQuarterRating (migration 0044): 1 to
// 5 in quarter-star steps, so a seller isn't forced to round a buyer up or
// down to the nearest whole star. Clicking (or hovering, for the preview)
// anywhere in a star's left/right quarters snaps to that quarter rather
// than only ever registering a whole star.
function QuarterStarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? value;

  function quarterAt(e: MouseEvent<HTMLDivElement>, starIndex: number): number {
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    const quarterSteps = Math.min(4, Math.max(1, Math.ceil(fraction * 4)));
    return starIndex + quarterSteps / 4;
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1" onMouseLeave={() => setHover(null)}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="cursor-pointer p-0.5"
            onMouseMove={(e) => setHover(quarterAt(e, i))}
            onClick={(e) => onChange(quarterAt(e, i))}
          >
            <StarSlot fill={display - i} size={STAR_SIZE} />
          </div>
        ))}
      </div>
      {display > 0 && <span className="text-sm font-medium text-gray-700">{display.toFixed(2).replace(/\.?0+$/, "")}</span>}
    </div>
  );
}

// One rating per order, not per seller relationship (buyer_reviews.order_id
// is unique) — same toggle-expand shape as SellerReplyForm, doubling as
// both the "leave a review" and "edit your review" UI depending on whether
// existingReview is set.
export default function BuyerReviewForm({
  listingId,
  existingReview,
}: {
  listingId: string;
  existingReview: BuyerReview | null;
}) {
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(existingReview?.rating ?? 0);
  const [tag, setTag] = useState<BuyerReviewTag>(existingReview?.tag ?? "trustworthy");
  const [comment, setComment] = useState(existingReview?.comment ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (rating < 1) {
      setError("Choose a rating.");
      return;
    }

    setSubmitting(true);
    try {
      await submitBuyerReview(listingId, { rating, tag, comment });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit review.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-4 w-full rounded-lg border border-brand-border py-1.5 text-xs font-medium text-brand-navy hover:bg-brand-surface"
      >
        {existingReview ? "Edit your review" : "Rate this buyer"}
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 border-t border-brand-border pt-4">
      <div>
        <p className="mb-1 text-xs font-medium text-gray-700">Rating</p>
        <QuarterStarPicker value={rating} onChange={setRating} />
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-gray-700">Describe this buyer</p>
        <div className="flex gap-1.5">
          {TAGS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTag(t.value)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                tag === t.value
                  ? "border-brand-navy bg-brand-navy text-white"
                  : "border-brand-border text-gray-600 hover:bg-brand-surface"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
        Comment (optional)
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={1000}
          rows={2}
          className="rounded-lg border border-brand-border px-2.5 py-1.5 text-sm outline-none focus:border-brand-navy"
          placeholder="Share your experience with this buyer"
        />
      </label>

      {error && <p className="text-xs text-brand-urgent">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="self-start rounded-full bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Saving..." : "Save review"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="self-start rounded-full px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
