import { Star } from "lucide-react";

// Read-only star display — the profile header's average and each review
// row both use this instead of duplicating the same five-icon markup.
export default function StarRating({
  rating,
  size = 16,
  filledClassName = "fill-brand-gold text-brand-gold",
  emptyClassName = "text-brand-border",
}: {
  rating: number;
  size?: number;
  // Callers on a background where the default gold-on-gold star loses
  // contrast (e.g. ListingRow's gray seller pill) can override the fill
  // and stroke — the star's outline is CSS `stroke`, driven by the text
  // color class, not the fill class, so getting a colored fill with a
  // visible outline of a *different* color needs both set explicitly.
  filledClassName?: string;
  emptyClassName?: string;
}) {
  const rounded = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} className={n <= rounded ? filledClassName : emptyClassName} />
      ))}
    </span>
  );
}
