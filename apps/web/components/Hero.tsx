import Link from "next/link";
import Image from "next/image";
import { ShieldCheck } from "lucide-react";
import FeaturedAuctionCards from "./FeaturedAuctionCards";
import {
  formatSellerTier,
  sellerTierAccentColorClass,
  sellerTierIconSrc,
  sellerTierRate,
  type Listing,
} from "@/lib/types";

// tier is the viewer's own seller trust tier — same reasoning as TopBar's:
// null (logged out, or never sold anything) falls back to the New tier's
// 7.00% rate, since that's the real starting rate rather than a flat
// number nobody actually pays.
export default function Hero({
  featuredAuctions,
  tier = null,
}: {
  featuredAuctions: Listing[];
  tier?: Listing["sellerTier"] | null;
}) {
  const rate = sellerTierRate(tier ?? "new");
  const tierIcon = tier ? sellerTierIconSrc(tier) : null;
  // Only "Hous Trusted Seller" is long enough to need splitting — every
  // other tier's label (New/Bronze/Silver/Gold Seller) reads fine on one
  // line next to the 40px icon, per product decision.
  const tierLabel = formatSellerTier(tier ?? "new");
  const tierLabelLine1 = tier === "hous_trust" ? "Hous Trusted" : tierLabel;
  const tierLabelLine2 = tier === "hous_trust" ? "Seller" : "";
  return (
    <section className="bg-gradient-to-br from-brand-navy via-brand-navy-light to-slate-800 text-white">
      <div className="grid gap-10 px-10 py-8 sm:px-12 lg:grid-cols-2 lg:items-center lg:px-14 lg:py-10">
        <div className="flex flex-col gap-5">
          <span className="flex w-fit items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-brand-gold-light">
            {rate} + $0.30 seller fee
            {tier ? (
              <>
                {" · your "}
                <Link href="/tiers" className={`font-semibold hover:underline ${sellerTierAccentColorClass(tier)}`}>
                  {formatSellerTier(tier)}
                </Link>
                {" rate"}
              </>
            ) : (
              " · pay by bank and save"
            )}
          </span>
          <h1 className="text-3xl font-bold tracking-tight sm:whitespace-nowrap sm:text-4xl lg:text-3xl xl:text-4xl">
            The Marketplace for the People
          </h1>
          <p className="text-xl font-semibold text-brand-gold-light sm:text-2xl">
            Our Goal: To Make Fees as Low as Possible
          </p>
          <p className="max-w-md text-white/70">
            Buy and sell Pokémon, Magic, Yu-Gi-Oh!, Lorcana, Riftbound, and
            graded sports cards, without eBay&apos;s 13.75% fee.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="#ending-soon"
              className="rounded-full bg-brand-gold px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light"
            >
              Browse listings
            </Link>
            <Link
              href="/sell"
              className="rounded-full border border-white/30 px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-white/10"
            >
              Start selling
            </Link>
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-white/50">{tier ? "Your seller fee" : "Seller fee"}</dt>
              <dd className="text-lg font-bold text-brand-gold-light">{rate}</dd>
            </div>
            <div>
              <dt className="text-white/50">Your Seller Tier</dt>
              <dd className="mt-1 flex items-center gap-2">
                <Link
                  href="/tiers"
                  className="flex flex-col text-sm font-bold leading-tight text-brand-gold-light hover:underline"
                >
                  <span>{tierLabelLine1}</span>
                  {tierLabelLine2 && <span>{tierLabelLine2}</span>}
                </Link>
                {tierIcon ? (
                  <Image src={tierIcon} alt="" width={40} height={40} unoptimized />
                ) : (
                  <ShieldCheck size={32} className="text-brand-gold-light" />
                )}
              </dd>
            </div>
            <div>
              <dt className="text-white/50">Grading verified</dt>
              <dd className="text-lg font-bold text-brand-gold-light">
                PSA · BGS · CGC
              </dd>
            </div>
          </dl>
        </div>

        <FeaturedAuctionCards listings={featuredAuctions} />
      </div>
    </section>
  );
}
