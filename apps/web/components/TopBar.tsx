import Link from "next/link";
import Image from "next/image";
import {
  formatSellerTier,
  sellerTierAccentColorClass,
  sellerTierIconSrc,
  sellerTierRate,
  type Listing,
} from "@/lib/types";

// tier is the viewer's own seller trust tier (design doc v2 §3, CLAUDE.md
// §6.4) — every user defaults to "new" (7.00% + $0.30, the highest rate)
// until they've built up order history, so this strip is never wrong for
// who's actually looking at it: null (logged out) shows that same New
// starting rate, since that's what signing up and selling today would
// actually cost. Never a flat advertised number divorced from what any
// real seller pays — see app/tiers/page.tsx's "publish the full ladder"
// rule this mirrors.
export default function TopBar({ tier = null }: { tier?: Listing["sellerTier"] | null }) {
  const tierIcon = tier ? sellerTierIconSrc(tier) : null;
  return (
    <div className="hidden bg-brand-navy text-[11px] text-white/75 sm:block">
      <div className="flex items-center justify-between px-10 py-1.5 sm:px-12 lg:px-14">
        <span className="flex items-center gap-1.5">
          {tierIcon && <Image src={tierIcon} alt="" width={16} height={16} unoptimized />}
          {sellerTierRate(tier ?? "new")} + $0.30 seller fee
          {tier && (
            <>
              {" — your "}
              <Link
                href="/tiers"
                className={`italic font-semibold hover:underline ${sellerTierAccentColorClass(tier)}`}
              >
                {formatSellerTier(tier)}
              </Link>
              {" rate"}
            </>
          )}
          , every order payment protected.
        </span>
        <div className="flex items-center gap-4">
          <Link href="#" className="hover:text-white">
            Help &amp; Support
          </Link>
          <Link href="#" className="hover:text-white">
            Sell on AuctionHous
          </Link>
        </div>
      </div>
    </div>
  );
}
