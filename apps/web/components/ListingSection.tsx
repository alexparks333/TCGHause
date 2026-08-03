import Link from "next/link";
import type { Listing, MyBid } from "@/lib/types";
import ListingCard from "./ListingCard";

export default function ListingSection({
  id,
  title,
  subtitle,
  items,
  watchedIds,
  isLoggedIn = false,
  myBidsByListingId,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  items: Listing[];
  watchedIds?: Set<string>;
  isLoggedIn?: boolean;
  myBidsByListingId?: Map<string, MyBid>;
}) {
  return (
    <section id={id} className="py-10">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
        <Link href="#" className="text-sm font-medium text-brand-navy hover:underline">
          View all
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {items.map((listing) => (
          <ListingCard
            key={listing.id}
            listing={listing}
            initialWatching={watchedIds?.has(listing.id) ?? false}
            isLoggedIn={isLoggedIn}
            myBid={myBidsByListingId?.get(listing.id)}
          />
        ))}
      </div>
    </section>
  );
}
