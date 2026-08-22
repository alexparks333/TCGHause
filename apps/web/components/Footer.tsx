import Link from "next/link";

type FooterLink = { label: string; href: string };

// Every link defaults to "#" (unwired) unless a real destination exists —
// only the Sell column and "Help & Support" point anywhere real right now.
// Start selling / Seller fees / Seller tiers / Seller information all route
// through pages that already exist (or, for Seller information, exist as of
// this change) rather than being decorative like the rest of the footer
// still is.
const COLUMNS: { heading: string; links: FooterLink[] }[] = [
  {
    heading: "Buy",
    links: [
      { label: "Pokémon", href: "#" },
      { label: "Magic: The Gathering", href: "#" },
      { label: "Yu-Gi-Oh!", href: "#" },
      { label: "Sports Cards & Slabs", href: "#" },
    ],
  },
  {
    heading: "Sell",
    links: [
      // Handles Stripe Connect onboarding itself when a seller isn't set up
      // yet — see apps/web/app/sell/page.tsx.
      { label: "Start selling", href: "/sell" },
      { label: "Seller fees", href: "/tiers" },
      { label: "Seller tiers", href: "/tiers" },
      { label: "Seller information", href: "/seller-terms" },
    ],
  },
  {
    heading: "Trust & Safety",
    links: [
      { label: "Buyer protection", href: "#" },
      { label: "Dispute resolution", href: "#" },
      { label: "Grading verification", href: "#" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "#" },
      { label: "Help & Support", href: "/support" },
      { label: "Terms", href: "#" },
      { label: "Privacy", href: "#" },
    ],
  },
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
                <li key={link.label}>
                  <Link href={link.href} className="hover:text-white">
                    {link.label}
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
