import { notFound } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ReviewsList from "@/components/ReviewsList";
import ProfileEditor from "@/components/profile/ProfileEditor";
import ReviewForm from "./ReviewForm";
import {
  getUserByUsername,
  getActiveListings,
  getSellerReviews,
  getBuyerStats,
  getMyWatchedIds,
  getReviewablePurchases,
} from "@/lib/api";
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

  const [listings, reviewSummary, buyerStats, watchedIds, reviewablePurchases] = await Promise.all([
    getActiveListings({ sellerId: profile.id }),
    getSellerReviews(username),
    getBuyerStats(username),
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
        <ProfileEditor
          profile={profile}
          joinedAt={joinedAt}
          reviewSummary={reviewSummary}
          buyerStats={buyerStats}
          isOwner={isOwner}
          isLoggedIn={Boolean(local)}
          listings={listings}
          watchedIds={watchedIds}
        />

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
