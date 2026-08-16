import Image from "next/image";
import { ShieldCheck, AtSign, FileText, Bell, User, MapPin, MessageSquare, CreditCard, Landmark } from "lucide-react";
import Avatar from "@/components/Avatar";
import StarRating from "@/components/StarRating";
import ReviewsList from "@/components/ReviewsList";
import SavedCardsManager from "@/components/SavedCardsManager";
import SavedBanksManager from "@/components/SavedBanksManager";
import SellerPayoutsSetup from "@/components/SellerPayoutsSetup";
import UsernameForm from "./UsernameForm";
import BioForm from "./BioForm";
import AddressForm from "./AddressForm";
import { getCurrentSession } from "@/lib/session";
import {
  getMe,
  getMyAddress,
  getSavedCards,
  getSavedBanks,
  getSellerConnectStatus,
  getSellerReviews,
  type SellerConnectStatus,
} from "@/lib/api";
import { isStripeConfigured } from "@/lib/stripe";
import { formatSellerTier, sellerTierIconSrc, sellerTierRate } from "@/lib/types";

const NOTIFICATION_PREFS = [
  "Outbid alerts",
  "Auction ending soon",
  "New messages",
  "Order updates",
];

export default async function AccountSettingsPage() {
  // getCurrentSession() already calls Supabase's getUser() internally —
  // reusing its result here instead of a second direct getUser() call
  // saves a full extra round trip to Supabase's auth server on every load
  // of this page.
  const { session, user } = await getCurrentSession();
  // getMe and getMyAddress only depend on `session` (already resolved),
  // not on each other, so they run in parallel — getSellerReviews is the
  // only one with a genuine dependency (me.username), so it has to wait
  // for getMe specifically, not for getMyAddress too.
  const noConnectStatus: SellerConnectStatus = {
    hasAccount: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
  };
  const [me, address, savedCards, savedBanks, connectStatus] = await Promise.all([
    session ? getMe(session.access_token).catch(() => null) : Promise.resolve(null),
    session ? getMyAddress(session.access_token).catch(() => null) : Promise.resolve(null),
    session && isStripeConfigured()
      ? getSavedCards(session.access_token).catch(() => [])
      : Promise.resolve([]),
    session && isStripeConfigured()
      ? getSavedBanks(session.access_token).catch(() => [])
      : Promise.resolve([]),
    session && isStripeConfigured()
      ? getSellerConnectStatus(session.access_token).catch(() => noConnectStatus)
      : Promise.resolve(noConnectStatus),
  ]);
  const reviewSummary = me?.username
    ? await getSellerReviews(me.username).catch(() => null)
    : null;
  const reviews = reviewSummary?.reviews ?? [];
  const averageRating = reviewSummary?.averageRating ?? 0;
  const reviewCount = reviewSummary?.count ?? 0;

  const email = user?.email ?? "";
  const avatarUrl = user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture;
  const fullName = user?.user_metadata?.full_name ?? user?.user_metadata?.name;

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

        {isStripeConfigured() && (
          <section className="rounded-xl border border-brand-border bg-white p-5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand-navy">
                <CreditCard size={15} />
              </span>
              <h2 className="text-sm font-semibold text-gray-900">Payment Methods</h2>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Save a card once, and Buy It Now checkout will use it automatically — no need
              to type a test card every time.
            </p>
            <SavedCardsManager initialCards={savedCards} />
          </section>
        )}

        {isStripeConfigured() && (
          <section className="rounded-xl border border-brand-border bg-white p-5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand-navy">
                <Landmark size={15} />
              </span>
              <h2 className="text-sm font-semibold text-gray-900">Linked Bank Accounts</h2>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Link a bank account once, and &quot;Pay by bank instead&quot; checkout will use
              it automatically. This is separate from your seller payout bank account below —
              it&apos;s what you pay WITH as a buyer, not where sale proceeds go.
            </p>
            <SavedBanksManager initialBanks={savedBanks} />
          </section>
        )}

        {isStripeConfigured() && (
          <section className="rounded-xl border border-brand-border bg-white p-5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand-navy">
                <ShieldCheck size={15} />
              </span>
              <h2 className="text-sm font-semibold text-gray-900">Payouts</h2>
            </div>
            <SellerPayoutsSetup initialStatus={connectStatus} />
          </section>
        )}

        <section className="rounded-xl border border-brand-border bg-white p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand-navy">
              <ShieldCheck size={15} />
            </span>
            <h2 className="text-sm font-semibold text-gray-900">Seller status</h2>
          </div>
          <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
            {sellerTierIconSrc(me?.tier ?? "new") ? (
              <Image src={sellerTierIconSrc(me?.tier ?? "new")!} alt="" width={14} height={14} unoptimized />
            ) : (
              <ShieldCheck size={13} />
            )}{" "}
            {formatSellerTier(me?.tier ?? "new")} —{" "}
            {sellerTierRate(me?.tier ?? "new")} + $0.30 per sale
          </span>
          <p className="mt-3 text-sm text-gray-500">
            Every seller starts here. Your rate drops automatically as you complete more
            orders with a clean dispute record — never something you have to ask for.
          </p>
          <ul className="mt-3 flex flex-col gap-1 text-xs text-gray-500">
            <li>15 completed orders → Bronze, 6.50% + $0.30</li>
            <li>50 completed orders → Silver, 6.25% + $0.30</li>
            <li>150 completed orders → Gold, 6.00% + $0.30</li>
            <li>500 completed orders → Haus Trust, 5.50% + $0.30</li>
          </ul>
          <a href="/tiers" className="mt-3 inline-block text-xs font-medium text-brand-navy hover:underline">
            See the full fee ladder
          </a>
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
          <ReviewsList reviews={reviews} username={me?.username ?? undefined} isOwner />
        </section>
      </div>
    </div>
  );
}
