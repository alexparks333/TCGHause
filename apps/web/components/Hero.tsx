import Link from "next/link";
import FeaturedAuctionCards from "./FeaturedAuctionCards";
import type { Listing } from "@/lib/types";

export default function Hero({ featuredAuctions }: { featuredAuctions: Listing[] }) {
  return (
    <section className="bg-gradient-to-br from-brand-navy via-brand-navy-light to-slate-800 text-white">
      <div className="grid gap-10 px-10 py-14 sm:px-12 lg:grid-cols-2 lg:items-center lg:px-14 lg:py-20">
        <div className="flex flex-col gap-5">
          <span className="w-fit rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-brand-gold-light">
            2% flat seller fee · escrow on every order
          </span>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            The marketplace built for the people.
          </h1>
          <p className="max-w-md text-white/70">
            Buy and sell Pokémon, Magic, Yu-Gi-Oh!, Lorcana, Riftbound, and
            graded sports cards, without the 13% incumbent cut.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="#ending-soon"
              className="rounded-full bg-brand-gold px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light"
            >
              Browse listings
            </Link>
            <Link
              href="#"
              className="rounded-full border border-white/30 px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-white/10"
            >
              Start selling
            </Link>
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-white/50">Seller fee</dt>
              <dd className="text-lg font-bold text-brand-gold-light">2.0%</dd>
            </div>
            <div>
              <dt className="text-white/50">Escrow release</dt>
              <dd className="text-lg font-bold text-brand-gold-light">24hr</dd>
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
