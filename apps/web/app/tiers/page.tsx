import Image from "next/image";
import { Landmark, ShieldCheck } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import TierFeeExplorer from "@/components/TierFeeExplorer";
import { sellerTierIconSrc } from "@/lib/types";
import { getCurrentSession } from "@/lib/session";
import { getMe } from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";

// Design doc v2 §2.7's hard requirement: "Publish the full tier ladder
// openly. Do not advertise a single rate most sellers don't pay." — a
// real, public page, not buried in a settings panel. Numbers here mirror
// apps/api/internal/seller/tier.go and pkg/fees exactly; if either
// changes, update this page to match. icon reuses the same engraved-card
// art shown next to a seller's name everywhere else on the site
// (sellerTierIconSrc) — "new" has none yet, so that row falls back to a
// plain ShieldCheck like it always has. accent is this page's own
// light-background tier color (sellerTierAccentColorClass in lib/types.ts
// is tuned for the dark navy strip/Hero, not a white card list).
const TIERS = [
  {
    name: "New",
    tier: "new" as const,
    rate: "7.00%",
    requirement: "0–14 completed orders",
    accent: "text-gray-500",
  },
  {
    name: "Bronze",
    tier: "bronze" as const,
    rate: "6.50%",
    requirement: "15–49 completed orders",
    reviewRequirement: "5+ reviews, 4.0★ avg to unlock",
    accent: "text-[#a8672f]",
  },
  {
    name: "Silver",
    tier: "silver" as const,
    rate: "6.25%",
    requirement: "50–149 completed orders",
    reviewRequirement: "15+ reviews, 4.3★ avg to unlock",
    accent: "text-slate-500",
  },
  {
    name: "Gold",
    tier: "gold" as const,
    rate: "6.00%",
    requirement: "150–499 completed orders",
    reviewRequirement: "40+ reviews, 4.5★ avg to unlock",
    accent: "text-brand-gold",
  },
  {
    name: "Platinum",
    tier: "platinum" as const,
    rate: "5.50%",
    requirement: "500+ completed orders",
    reviewRequirement: "100+ reviews, 4.5★ avg to unlock",
    accent: "text-[#8a8f98]",
  },
  {
    name: "Hous Trust",
    tier: "hous_trust" as const,
    rate: "Custom",
    requirement: "Platinum + application, by invitation",
    accent: "text-sky-600",
  },
];

// The fee explorer below can't do live math against "Custom" — Hous
// Trust's rate is negotiated per seller, there's no one number to plug
// in — so it only ever gets the tiers with a real, fixed percentage.
// TierFeeExplorer's own fallback (tiers[0] when the selected/initial tier
// isn't in the list) means a Hous Trust viewer just lands on New here,
// same as anyone else visiting the page logged out.
const EXPLORABLE_TIERS = TIERS.filter((t) => t.tier !== "hous_trust");

export default async function TiersPage() {
  // Same session-then-tier read as Header (and both are cache()-wrapped,
  // so this doesn't cost a second round trip to Supabase/the Go API) —
  // what lets the fee explorer below start pre-selected on the viewer's
  // own tier instead of always defaulting to Gold. Logged-out (or a Go
  // API hiccup) falls back to "new", the same real default every user
  // row starts at, not a guess.
  const { session } = isSupabaseConfigured() ? await getCurrentSession() : { session: null };
  const me = session ? await getMe(session.access_token).catch(() => null) : null;
  const myTier = me?.tier ?? "new";
  // Distinct from myTier above: myTier always falls back to "new" so
  // TierFeeExplorer has something to pre-select even logged out. Highlighting
  // a card needs the opposite default — an anonymous visitor isn't "New",
  // they're not signed in at all, so only highlight a row once we've
  // actually confirmed the viewer's real tier from the API.
  const highlightTier = me?.tier ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      {/* Page-load card-flip reveal (§ below) is pure CSS so it works from
          a server component — no client-side JS needed just to animate
          once on mount. Scoped here rather than globals.css since nothing
          else on the site uses it yet. */}
      <style>{`
        @keyframes tierCardFlip {
          0% { transform: rotateY(0deg); }
          100% { transform: rotateY(180deg); }
        }
        @keyframes tierRowIn {
          0% { opacity: 0; transform: translateY(10px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-10 py-16 sm:px-12 lg:px-14">
        <h1 className="text-2xl font-bold text-gray-900">Seller fees, in full</h1>
        <p className="mt-2 text-sm text-gray-600">
          Every seller starts at <span className="font-semibold text-gray-900">New</span>. Complete
          more orders with a clean dispute record and your rate drops automatically — no
          application, nothing to ask for. Most sellers land on{" "}
          <span className="font-semibold text-brand-gold">Gold</span> (6% + $0.30);{" "}
          <span className="font-semibold text-[#8a8f98]">Platinum</span> earns{" "}
          <span className="font-semibold text-[#8a8f98]">5.50%</span> automatically the same way.{" "}
          <span className="font-semibold text-sky-600">Hous Trust</span> is different — an
          invitation-only application for Platinum sellers, with a rate we negotiate individually
          based on what you sell.
        </p>

        {/* An open list of floating cards, not a boxed table — each tier
            gets its own hover-lift card, and the icon side flips over
            (face-down "card back" → the real tier icon) the moment the
            page loads, staggered row by row for a dealing-a-hand feel. */}
        <ul className="mt-8 flex flex-col gap-3">
          {TIERS.map((t, i) => {
            const icon = sellerTierIconSrc(t.tier);
            const isCurrent = t.tier === highlightTier;
            return (
              <li
                key={t.name}
                className={`group flex items-center gap-5 rounded-2xl bg-white p-4 shadow-sm ring-1 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg sm:p-5 ${
                  isCurrent ? "ring-2 ring-brand-gold bg-brand-gold/[0.06]" : "ring-brand-border"
                }`}
                style={{
                  animation: "tierRowIn 0.5s ease forwards",
                  animationDelay: `${i * 90}ms`,
                  opacity: 0,
                }}
              >
                <div className="relative h-14 w-14 shrink-0 sm:h-16 sm:w-16" style={{ perspective: "700px" }}>
                  <div
                    className="absolute inset-0"
                    style={{
                      transformStyle: "preserve-3d",
                      animation: "tierCardFlip 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
                      animationDelay: `${i * 90 + 250}ms`,
                    }}
                  >
                    {/* Face-down side — a plain card back, briefly visible
                        before the flip. */}
                    <div
                      className="absolute inset-0 flex items-center justify-center rounded-xl bg-gradient-to-br from-brand-navy via-brand-navy-light to-slate-700 shadow-inner"
                      style={{ backfaceVisibility: "hidden" }}
                    >
                      <Image src="/logo-v3.png" alt="" width={26} height={26} className="opacity-70" unoptimized />
                    </div>
                    {/* Face-up side — the real tier icon, or the plain
                        shield for New, which has no card art yet. */}
                    <div
                      className="absolute inset-0 flex items-center justify-center rounded-xl bg-brand-surface shadow-inner"
                      style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                    >
                      {icon ? (
                        <Image src={icon} alt="" width={42} height={42} unoptimized />
                      ) : (
                        <ShieldCheck size={30} className="text-gray-400" />
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-base font-bold text-gray-900">
                      {t.name}
                      {isCurrent && (
                        <span className="rounded-full bg-brand-gold px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                          Your tier
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">{t.requirement}</p>
                    {"reviewRequirement" in t && (
                      <p className="text-xs text-gray-400">{t.reviewRequirement}</p>
                    )}
                  </div>
                  <p className={`text-xl font-extrabold ${t.accent}`}>
                    {t.rate}
                    <span className="ml-1 text-xs font-medium text-gray-400">+ $0.30</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        <h2 className="mt-10 text-lg font-bold text-gray-900">What that looks like</h2>
        <TierFeeExplorer tiers={EXPLORABLE_TIERS} initialTier={myTier} />

        <div className="mt-8 flex items-start gap-2 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-brand-border text-sm text-gray-600">
          <Landmark size={18} className="mt-0.5 shrink-0 text-brand-navy" />
          <div>
            <p className="font-semibold text-gray-900">Buyers save by paying with bank transfer</p>
            <p className="mt-1">
              At checkout, buyers can pay by card (the listed price) or by bank (a real discount —
              never a card surcharge). A seller&apos;s net proceeds are identical either way; the
              bank discount comes out of our margin, never yours.
            </p>
          </div>
        </div>

        <p className="mt-6 text-xs text-gray-400">
          Cancelled and refunded orders never count toward your order total. Promotion also
          requires a trailing-90-day dispute rate under 2%, no unresolved claim older than 7
          days, an account at least 14 days old, and the review count/rating floor shown above
          for the tier you&apos;re moving into — the average blends all three rating axes
          (condition accuracy, shipping speed, trustworthiness) across every review you&apos;ve
          ever received, not just recent ones.
        </p>
      </main>
      <Footer />
    </div>
  );
}
