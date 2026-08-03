"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { apiFetch } from "@/lib/api";

export default function ReviewForm({ username }: { username: string }) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (rating < 1) {
      setError("Choose a star rating.");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch(`/users/${encodeURIComponent(username)}/reviews`, {
        method: "POST",
        body: JSON.stringify({ rating, comment }),
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
      <div>
        <p className="mb-1 text-sm font-medium text-gray-700">Your rating</p>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              onMouseEnter={() => setHoverRating(n)}
              onMouseLeave={() => setHoverRating(0)}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              className="p-0.5"
            >
              <Star
                size={22}
                className={
                  n <= (hoverRating || rating)
                    ? "fill-brand-gold text-brand-gold"
                    : "text-brand-border"
                }
              />
            </button>
          ))}
        </div>
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
