"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { ReviewableListing } from "@/lib/api";

const AXES = [
  { key: "conditionAccuracy", label: "Condition Accuracy" },
  { key: "shippingSpeed", label: "Shipping Speed" },
  { key: "trustworthiness", label: "Trustworthiness" },
] as const;

type AxisKey = (typeof AXES)[number]["key"];

function StarPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-gray-700">{label}</p>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            className="p-0.5"
          >
            <Star
              size={22}
              className={
                n <= (hover || value) ? "fill-brand-gold text-brand-gold" : "text-brand-border"
              }
            />
          </button>
        ))}
      </div>
    </div>
  );
}

// One review per purchase, not one per seller — reviewablePurchases is
// every purchase from this seller (won auction or Buy It Now) the caller
// hasn't reviewed yet, so a buyer who's bought three times can leave three
// separate reviews. Picking
// a purchase is only a dropdown (not three always-open forms) since most
// reviewers only have one eligible purchase at a time. Rating is three
// separate axes (CLAUDE.md §6.3's split-rating decision) rather than one
// overall star score.
export default function ReviewForm({
  username,
  reviewablePurchases,
}: {
  username: string;
  reviewablePurchases: ReviewableListing[];
}) {
  const [listingId, setListingId] = useState(reviewablePurchases[0]?.listingId ?? "");
  const [ratings, setRatings] = useState<Record<AxisKey, number>>({
    conditionAccuracy: 0,
    shippingSpeed: 0,
    trustworthiness: 0,
  });
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (AXES.some((axis) => ratings[axis.key] < 1)) {
      setError("Rate all three categories.");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch(`/users/${encodeURIComponent(username)}/reviews`, {
        method: "POST",
        body: JSON.stringify({ listingId, ...ratings, comment }),
      });
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit review.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <p className="rounded-xl border border-brand-border bg-white p-4 text-sm text-brand-success">
        Thanks for your review.
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-xl border border-brand-border bg-white p-4"
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
        Which purchase are you reviewing?
        <select
          value={listingId}
          onChange={(e) => setListingId(e.target.value)}
          className="rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
        >
          {reviewablePurchases.map((p) => (
            <option key={p.listingId} value={p.listingId}>
              {p.title}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
        {AXES.map((axis) => (
          <StarPicker
            key={axis.key}
            label={axis.label}
            value={ratings[axis.key]}
            onChange={(n) => setRatings((r) => ({ ...r, [axis.key]: n }))}
          />
        ))}
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
        Comment (optional)
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={1000}
          rows={3}
          className="rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
          placeholder="Share your experience with this seller"
        />
      </label>

      {error && <p className="text-sm text-brand-urgent">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="self-start rounded-full bg-brand-gold px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
      >
        {submitting ? "Submitting..." : "Submit review"}
      </button>
    </form>
  );
}
