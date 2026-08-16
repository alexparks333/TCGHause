import { notFound } from "next/navigation";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Avatar from "@/components/Avatar";
import ListingCard from "@/components/ListingCard";
import StarRating from "@/components/StarRating";
import ReviewsList from "@/components/ReviewsList";
import MessageSellerButton from "@/components/messages/MessageSellerButton";
import ReviewForm from "./ReviewForm";
import { getUserByUsername, getActiveListings, getSellerReviews, getMyWatchedIds, getReviewablePurchases } from "@/lib/api";
import { getLocalSession } from "@/lib/session";

export default async function SellerProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  // getUserByUsername and getLocalSession don't depend on each other, so
  // they run together instead of stacking — this page never displays
  // verified identity, only compares ids (isOwner) and reads the
  // access_token, so the fast local cookie read is enough; no need for
  // getCurrentSession()'s slower getUser() network verification.
  const [profile, local] = await Promise.all([getUserByUsername(username), getLocalSession()]);
  if (!profile) notFound();

  const isOwner = local?.userId === profile.id;

  const [listings, reviewSummary, watchedIds, reviewablePurchases] = await Promise.all([
    getActiveListings({ sellerId: profile.id }),
    getSellerReviews(username),
    local ? getMyWatchedIds(local.accessToken).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    local && !isOwner
      ? getReviewablePurchases(username, local.accessToken).catch(() => [])
      : Promise.resolve([]),
  ]);

  const joinedAt = new Date(profile.createdAt).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />

      <div className="w-full px-10 py-8 sm:px-12 lg:px-14">
        <section className="rounded-xl border border-brand-border bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <Avatar label={profile.username ?? "Seller"} size={64} />
              <div>
                <h1 className="text-xl font-bold text-gray-900">{profile.username}</h1>
                <p className="text-sm text-gray-500">Member since {joinedAt}</p>
                <a
                  href="#reviews"
                  className="mt-1 inline-flex items-center gap-2 rounded-full transition-opacity hover:opacity-70"
                  title="Jump to reviews"
                >
                  <StarRating rating={reviewSummary.averageRating} />
                  <span className="text-sm text-gray-500 underline decoration-dotted underline-offset-2">
                    {reviewSummary.count > 0
                      ? `${reviewSummary.averageRating.toFixed(1)} (${reviewSummary.count} review${reviewSummary.count === 1 ? "" : "s"})`
                      : "No reviews yet"}
                  </span>
                </a>
                {reviewSummary.count > 0 && (
                  <p className="mt-1 text-xs text-gray-500">
                    Condition Accuracy {reviewSummary.averageConditionAccuracy.toFixed(1)} · Shipping
                    Speed {reviewSummary.averageShippingSpeed.toFixed(1)} · Trustworthiness{" "}
                    {reviewSummary.averageTrustworthiness.toFixed(1)}
                  </p>
                )}
              </div>
            </div>
            {isOwner ? (
              <Link
                href="/account/settings"
                className="text-sm font-medium text-brand-navy hover:underline"
              >
                Edit in Account Settings
              </Link>
            ) : (
              local && (
                <div className="w-full max-w-xs sm:w-auto">
                  <MessageSellerButton recipientId={profile.id} recipientLabel={profile.username ?? "Seller"} />
                </div>
              )
            )}
          </div>

          {profile.bio && <p className="mt-4 whitespace-pre-wrap text-sm text-gray-700">{profile.bio}</p>}
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-bold text-gray-900">Listings</h2>
          {listings.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">No active listings.</p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {listings.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  initialWatching={watchedIds.has(listing.id)}
                  isLoggedIn={Boolean(local)}
                />
              ))}
            </div>
          )}
        </section>

        <section id="reviews" className="mt-8 max-w-2xl scroll-mt-32">
          <h2 className="text-lg font-bold text-gray-900">Reviews</h2>

          {!isOwner && local && (
            <div className="mt-4">
              {reviewablePurchases.length > 0 ? (
                <ReviewForm username={username} reviewablePurchases={reviewablePurchases} />
              ) : (
                <p className="rounded-xl border border-brand-border bg-white p-4 text-sm text-gray-500">
                  You can leave a review once you&apos;ve bought something from {profile.username}.
                </p>
              )}
            </div>
          )}

          <ReviewsList reviews={reviewSummary.reviews} username={username} isOwner={isOwner} />
        </section>
      </div>

      <Footer />
    </div>
  );
}
