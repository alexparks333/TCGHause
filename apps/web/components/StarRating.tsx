import { Star } from "lucide-react";

// Read-only star display — the profile header's average and each review
// row both use this instead of duplicating the same five-icon markup.
export default function StarRating({
  rating,
  size = 16,
}: {
  rating: number;
  size?: number;
}) {
  const rounded = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={n <= rounded ? "fill-brand-gold text-brand-gold" : "text-brand-border"}
        />
      ))}
    </span>
  );
}
