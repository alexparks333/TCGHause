import Avatar from "./Avatar";
import StarRating from "./StarRating";
import type { Review } from "@/lib/api";

// Shared between the public seller profile page and the owner's own
// Account Settings page — same reviews, same rendering, just a different
// header/context around it.
export default function ReviewsList({ reviews }: { reviews: Review[] }) {
  if (reviews.length === 0) {
    return <p className="mt-4 text-sm text-gray-500">No reviews yet.</p>;
  }

  return (
    <ul className="mt-4 flex flex-col gap-4">
      {reviews.map((review) => (
        <li key={review.id} className="rounded-xl border border-brand-border bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Avatar label={review.reviewerUsername ?? "Someone"} size={28} />
              <span className="text-sm font-semibold text-gray-900">
                {review.reviewerUsername ?? "Someone"}
              </span>
            </div>
            <StarRating rating={review.rating} size={14} />
          </div>
          {review.comment && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{review.comment}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
