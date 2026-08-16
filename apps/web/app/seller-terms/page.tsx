import Header from "@/components/Header";
import Footer from "@/components/Footer";

// Linked from the footer's Sell column as "Seller information" and from
// anywhere else a seller needs the full rulebook in one place, rather than
// scattered across the Sell wizard, Account Settings, and the tiers page.
// Numbers here mirror docs/PercentageModel.md (the v2 fee/payout model) and
// apps/api/internal/seller/tier.go — if either changes, update this page too.
export const metadata = {
  title: "Seller Terms of Service | AuctionHous - TCG",
};

const TIER_LADDER = [
  { name: "New", rate: "7.00%", requirement: "0–14 completed orders" },
  { name: "Bronze", rate: "6.50%", requirement: "15–49 completed orders" },
  { name: "Silver", rate: "6.25%", requirement: "50–149 completed orders" },
  { name: "Gold", rate: "6.00%", requirement: "150–499 completed orders" },
  { name: "Haus Trust", rate: "5.50%", requirement: "500+ completed orders" },
];

const LIABILITY = [
  { scenario: "Item wasn't as described", responsible: "Seller" },
  { scenario: "Buyer says “never arrived,” no tracking exists", responsible: "Seller" },
  {
    scenario: "Buyer says “never arrived,” tracking shows delivered, order under $50",
    responsible: "Platform (absorbed, not disputed)",
  },
  { scenario: "Same, but order is $50 or more", responsible: "Buyer, after a fraud review" },
  { scenario: "Payment fraud / stolen card used", responsible: "Platform" },
  { scenario: "Buyer changed their mind", responsible: "Buyer — not covered" },
  {
    scenario: "Item damaged in transit, seller has adequate packing evidence",
    responsible: "Platform, up to $100",
  },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-gray-600">{children}</div>
    </section>
  );
}

export default function SellerTermsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-10 py-16 sm:px-12 lg:px-14">
        <h1 className="text-2xl font-bold text-gray-900">Seller Terms of Service</h1>
        <p className="mt-2 text-sm text-gray-600">
          This page covers the rules specific to selling on AuctionHous - TCG — fees, payouts,
          listing standards, and what happens when something goes wrong. It supplements, and doesn't
          replace, the general site Terms every account agrees to. By creating a listing, you agree
          to everything below.
        </p>

        <Section title="1. Who you're selling as">
          <p>
            Every charge on AuctionHous - TCG is a Stripe Connect direct charge: a buyer's payment
            goes straight into <em>your</em> Stripe account the instant it succeeds, not into a
            platform-held balance. That makes you the merchant of record for your own sales. Before
            your first listing goes live, Stripe verifies your identity (a one-time onboarding flow
            linked from the Sell page or Account Settings) so it knows where to send your money.
          </p>
          <p>
            We never hold your funds. What we control is <em>timing</em> — when Stripe pays out
            money that's already yours from your Stripe balance into your bank account, not whether
            you get it.
          </p>
        </Section>

        <Section title="2. Fees">
          <p>
            Every completed sale is charged a flat <strong>$0.30</strong> plus a percentage of the
            item price and shipping (never sales tax), set by your seller tier below. There's no
            minimum-order exemption — the same formula applies whether the item is $2 or $2,000.
          </p>
          <div className="mt-3 overflow-hidden rounded-xl ring-1 ring-brand-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-white text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Tier</th>
                  <th className="px-4 py-2 font-medium">Rate</th>
                  <th className="px-4 py-2 font-medium">Reached at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border bg-white">
                {TIER_LADDER.map((t) => (
                  <tr key={t.name}>
                    <td className="px-4 py-2 font-medium text-gray-900">{t.name}</td>
                    <td className="px-4 py-2">{t.rate} + $0.30</td>
                    <td className="px-4 py-2 text-gray-500">{t.requirement}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Tier is based on your trailing completed-order history and dispute rate, not something
            you apply for — see the full breakdown on the{" "}
            <a href="/tiers" className="font-medium text-brand-navy underline hover:text-brand-gold">
              seller fees page
            </a>
            . A trailing 90-day dispute rate above 4% drops you one tier, with a 30-day cooldown
            before you can re-promote; cancelled or refunded orders never count toward promotion.
          </p>
          <p>
            Your net proceeds are the same no matter how the buyer pays — if a buyer chooses the
            discounted bank-transfer option, that discount comes out of platform margin, never out
            of what you're paid.
          </p>
        </Section>

        <Section title="3. Getting paid">
          <p>
            Payouts are batched weekly by default. You can opt into per-order or instant payouts from
            Account Settings; instant payout carries an additional cost since Stripe charges us for
            it. Gold and Haus Trust sellers skip the standard claim-window wait entirely — payout
            releases the moment the carrier scans your package as delivered, instead of waiting out
            the standard hold.
          </p>
          <p>
            First-time sellers should expect a short hold on their very first payout while Stripe
            finishes verifying the connected account — this is a one-time identity-verification
            step, not a recurring delay.
          </p>
        </Section>

        <Section title="4. Listing standards">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Condition and grade must be accurate. This is the single highest-weighted factor in your feedback score and the most common source of disputes — describe flaws you can see, not just the ones you think matter.</li>
            <li>Graded slabs require a real, verifiable cert number from PSA, BGS, or CGC. Listings with cert numbers that don't verify against the grading company's own lookup will be removed.</li>
            <li>Photos must be of the actual card or slab being sold, not a stock image or a photo of a different copy.</li>
            <li>Required item specifics (game, set, card number, and condition or grade) must be filled in accurately — this is also what makes your listing findable in search and filters.</li>
          </ul>
        </Section>

        <Section title="5. Shipping">
          <p>
            Items $20 and over require tracked shipping. Items under $20 may ship tracked or via
            Plain White Envelope with basic tracking. Ship within your stated handling time —
            late or untracked shipping on a disputed order shifts liability toward you (see §7
            below).
          </p>
        </Section>

        <Section title="6. Prohibited items and conduct">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Counterfeit cards, counterfeit slabs, or slabs with tampered or resealed holders.</li>
            <li>Listings priced or described to intentionally mislead a buyer about condition, grade, or authenticity.</li>
            <li>Attempting to move a transaction off-platform to avoid fees.</li>
            <li>Manipulating your own dispute rate or order count — including self-dealing across buyer accounts you control — to game tier promotion.</li>
          </ul>
          <p>
            Violations can result in listing removal, tier demotion, or account suspension, depending
            on severity.
          </p>
        </Section>

        <Section title="7. Disputes and who's on the hook">
          <p>
            We don't offer unconditional buyer protection — at our fee levels that can't be
            funded, so responsibility is assigned plainly instead of left ambiguous:
          </p>
          <div className="mt-3 overflow-hidden rounded-xl ring-1 ring-brand-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-white text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">What happened</th>
                  <th className="px-4 py-2 font-medium">Who's responsible</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border bg-white">
                {LIABILITY.map((row) => (
                  <tr key={row.scenario}>
                    <td className="px-4 py-2 text-gray-900">{row.scenario}</td>
                    <td className="px-4 py-2 text-gray-500">{row.responsible}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Most condition disputes can be closed with a partial refund you propose directly to the
            buyer, without escalating to a full return. Repeated disputes affect your tier
            regardless of outcome, since tier reflects dispute <em>rate</em>, not fault.
          </p>
        </Section>

        <Section title="8. Account suspension">
          <p>
            We can suspend listing privileges pending review if your account shows a pattern of
            disputes, a counterfeit-item finding, or repeated listing-standards violations. You'll
            be told the specific reason, not a generic notice — the same standard we hold tier
            demotions to.
          </p>
        </Section>

        <Section title="9. Changes to these terms">
          <p>
            We may update this page as the fee model or payout mechanics change. Material changes
            (a fee increase, a new tier threshold, a change to dispute liability) will be
            communicated before they apply to sales already in progress.
          </p>
        </Section>

        <p className="mt-10 border-t border-brand-border pt-6 text-xs text-gray-400">
          Questions about a specific fee, payout, or dispute? Reach out through your account's
          support contact rather than relying on this page alone — it describes the general
          rules, not your specific case.
        </p>
      </main>
      <Footer />
    </div>
  );
}
