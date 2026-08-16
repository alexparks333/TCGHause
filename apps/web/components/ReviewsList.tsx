import Avatar from "./Avatar";
import StarRating from "./StarRating";
import SellerReplyForm from "./SellerReplyForm";
import type { Review } from "@/lib/api";

const AXES = [
  { key: "conditionAccuracy", label: "Condition Accuracy" },
  { key: "shippingSpeed", label: "Shipping Speed" },
  { key: "trustworthiness", label: "Trustworthiness" },
] as const;

// Shared between the public seller profile page and the owner's own
// Account Settings page — same reviews, same rendering, just a different
// header/context around it. `username` + `isOwner` are only needed so the
// seller-reply UI (one reply per review, CLAUDE.md's review system) can
// render and know whose reply endpoint to call — every other caller can
// omit them and just gets read-only reviews.
export default function ReviewsList({
  reviews,
  username,
  isOwner = false,
}: {
  reviews: Review[];
  username?: string;
  isOwner?: boolean;
}) {
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
              <div>
                <span className="text-sm font-semibold text-gray-900">
                  {review.reviewerUsername ?? "Someone"}
                </span>
                <span className="ml-1.5 text-xs text-gray-400">
                  · {review.reviewerReviewCount} review
                  {review.reviewerReviewCount === 1 ? "" : "s"} written
                </span>
              </div>
            </div>
            <StarRating rating={review.overallRating} size={14} />
          </div>

          <p className="mt-1 text-xs text-gray-500">Verified purchase: {review.listingTitle}</p>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {AXES.map((axis) => (
              <span key={axis.key} className="flex items-center gap-1 text-xs text-gray-500">
                {axis.label}
                <StarRating rating={review[axis.key]} size={11} />
              </span>
            ))}
          </div>

          {review.comment && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{review.comment}</p>
          )}

          {review.sellerReply && (
            <div className="mt-3 rounded-lg bg-brand-surface p-3">
              <p className="text-xs font-semibold text-gray-700">Seller reply</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{review.sellerReply}</p>
            </div>
          )}

          {isOwner && username && (
            <SellerReplyForm
              username={username}
              reviewId={review.id}
              existingReply={review.sellerReply}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
