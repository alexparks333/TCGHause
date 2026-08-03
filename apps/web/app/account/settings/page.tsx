import { ShieldCheck, AtSign, FileText, Bell, User, MapPin, MessageSquare } from "lucide-react";
import Avatar from "@/components/Avatar";
import StarRating from "@/components/StarRating";
import ReviewsList from "@/components/ReviewsList";
import UsernameForm from "./UsernameForm";
import BioForm from "./BioForm";
import AddressForm from "./AddressForm";
import { getCurrentSession } from "@/lib/session";
import { getMe, getMyAddress, getSellerReviews } from "@/lib/api";

const NOTIFICATION_PREFS = [
  "Outbid alerts",
  "Auction ending soon",
  "New messages",
  "Order updates",
];

const SALES_TO_NEXT_TIER = 10;
const SALES_COMPLETED = 0;

export default async function AccountSettingsPage() {
  // getCurrentSession() already calls Supabase's getUser() internally —
  // reusing its result here instead of a second direct getUser() call
  // saves a full extra round trip to Supabase's auth server on every load
  // of this page.
  const { session, user } = await getCurrentSession();
  const me = session ? await getMe(session.access_token).catch(() => null) : null;
  // getMyAddress and getSellerReviews don't depend on each other (only on
  // `me`, already resolved above), so they run in parallel rather than
  // stacking as two more sequential Go-API round trips.
  const [address, reviewSummary] = await Promise.all([
    session ? getMyAddress(session.access_token).catch(() => null) : Promise.resolve(null),
    me?.username ? getSellerReviews(me.username).catch(() => null) : Promise.resolve(null),
  ]);
  const reviews = reviewSummary?.reviews ?? [];
  const averageRating = reviewSummary?.averageRating ?? 0;
  const reviewCount = reviewSummary?.count ?? 0;

  const email = user?.email ?? "";
  const avatarUrl = user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture;
  const fullName = user?.user_metadata?.full_name ?? user?.user_metadata?.name;

  const tierProgress = Math.min(100, (SALES_COMPLETED / SALES_TO_NEXT_TIER) * 100);

  return (
    <div className="px-10 py-8 sm:px-12 lg:px-14">
      <h1 className="text-xl font-bold text-gray-900">Account Settings</h1>
      <p className="mt-1 text-sm text-gray-500">
        Your profile, seller status, and notification preferences.
      </p>

      <a
        href="#reviews"
        className="mt-4 flex items-center gap-3 rounded-2xl border border-brand-border bg-white px-5 py-4 shadow-sm transition-colors hover:bg-brand-surface"
      >
        <StarRating rating={averageRating} size={22} />
        <span className="text-lg font-bold text-gray-900">
          {reviewCount > 0 ? averageRating.toFixed(1) : "—"}
        </span>
        <span className="text-sm text-gray-500">
          {reviewCount} comment{reviewCount === 1 ? "" : "s"}
        </span>
        <span className="ml-auto text-sm font-medium text-brand-navy">
          View reviews ↓
        </span>
      </a>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-brand-border bg-white p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand-navy">
              <User size={15} />
            </span>
            <h2 className="text-sm font-semibold text-gray-900">Profile</h2>
          </div>
          <div className="mt-4 flex items-center gap-4">
            <Avatar src={avatarUrl} label={email || "?"} size={56} />
            <div className="min-w-0">
              {fullName && (
                <p className="truncate font-medium text-gray-900">{fullName}</p>
              )}
              <p className="truncate text-sm text-gray-500">{email}</p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-brand-border bg-white p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand-navy">
              <AtSign size={15} />
            </span>
            <h2 className="text-sm font-semibold text-gray-900">Username</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Shown on your listings and everywhere else instead of your email.
          </p>
          <div className="mt-4">
            <UsernameForm currentUsername={me?.username ?? null} />
          </div>
        </section>

        <section className="rounded-xl border border-brand-border bg-white p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand-navy">
              <FileText size={15} />
            </span>
            <h2 className="text-sm font-semibold text-gray-900">Bio</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Shown on your public seller profile page.
          </p>
          <div className="mt-4">
            <BioForm currentBio={me?.bio ?? null} />
          </div>
        </section>

        <section className="rounded-xl border border-brand-border bg-white p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand-navy">
              <MapPin size={15} />
            </span>
            <h2 className="text-sm font-semibold text-gray-900">Shipping Address</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Used to ship items to you when buying, and as your return address when
            selling. Never shown to other users.
          </p>
          <div className="mt-4">
            <AddressForm currentAddress={address} />
          </div>
        </section>

        <section className="rounded-xl border border-brand-border bg-white p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand-navy">
              <ShieldCheck size={15} />
            </span>
            <h2 className="text-sm font-semibold text-gray-900">Seller status</h2>
          </div>
          <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
            <ShieldCheck size={13} /> Tier 1 — Probationary
          </span>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-brand-surface">
            <div
              className="h-full rounded-full bg-brand-gold transition-all"
              style={{ width: `${tierProgress}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-gray-500">
            {SALES_COMPLETED} of {SALES_TO_NEXT_TIER} sales completed. Funds are held in
            escrow for 72 hours after delivery, listings are capped at $200, and tracked
            shipping is required on every item until you reach Tier 2.
          </p>
        </section>

        <section className="rounded-xl border border-brand-border bg-white p-5 lg:col-span-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand-navy">
              <Bell size={15} />
            </span>
            <h2 className="text-sm font-semibold text-gray-900">Notifications</h2>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            {NOTIFICATION_PREFS.map((label) => (
              <label
                key={label}
                className="flex items-center justify-between text-sm text-gray-700"
              >
                {label}
                <input
                  type="checkbox"
                  defaultChecked
                  className="h-4 w-4 rounded border-brand-border accent-brand-navy"
                />
              </label>
            ))}
          </div>
        </section>

        <section id="reviews" className="scroll-mt-32 rounded-xl border border-brand-border bg-white p-5 lg:col-span-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand-navy">
              <MessageSquare size={15} />
            </span>
            <h2 className="text-sm font-semibold text-gray-900">Reviews</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            What other people have said about buying from or selling to you.
          </p>
          <ReviewsList reviews={reviews} />
        </section>
      </div>
    </div>
  );
}
