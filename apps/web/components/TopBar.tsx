import Link from "next/link";

export default function TopBar() {
  return (
    <div className="hidden bg-brand-navy text-[11px] text-white/75 sm:block">
      <div className="flex items-center justify-between px-10 py-1.5 sm:px-12 lg:px-14">
        <span>Flat 2% seller fee, every order escrow protected.</span>
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
