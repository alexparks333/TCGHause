import Link from "next/link";

const COLUMNS: { heading: string; links: string[] }[] = [
  { heading: "Buy", links: ["Pokémon", "Magic: The Gathering", "Yu-Gi-Oh!", "Sports Cards & Slabs"] },
  { heading: "Sell", links: ["Start selling", "Seller fees", "Seller tiers", "Bulk listing tool"] },
  { heading: "Trust & Safety", links: ["Buyer protection", "Dispute resolution", "Grading verification"] },
  { heading: "Company", links: ["About", "Help & Support", "Terms", "Privacy"] },
];

export default function Footer() {
  return (
    <footer className="mt-auto bg-brand-navy text-white/70">
      <div className="grid gap-8 px-10 py-12 sm:grid-cols-2 sm:px-12 lg:grid-cols-4 lg:px-14">
        {COLUMNS.map((col) => (
          <div key={col.heading}>
            <h3 className="mb-3 text-sm font-semibold text-white">{col.heading}</h3>
            <ul className="space-y-2 text-sm">
              {col.links.map((link) => (
                <li key={link}>
                  <Link href="#" className="hover:text-white">
                    {link}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 px-10 py-4 text-xs sm:px-12 lg:px-14">
        <p>
          &copy; {new Date().getFullYear()} AuctionHous - TCG. Not affiliated with eBay, PSA, BGS, CGC, or any card publisher.{" "}
          <a href="/admin.html" className="text-white/20 hover:text-white/50">
            &middot;
          </a>
        </p>
      </div>
    </footer>
  );
}
