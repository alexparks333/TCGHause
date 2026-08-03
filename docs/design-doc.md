# Project Design Document: "AuctionHous - TCG"

**Version:** 1.0
**Target Market:** Trading Card Games & Collectibles (Pokémon, Magic: The Gathering, Yu-Gi-Oh!, Lorcana, Riftbound, Sports Cards & Graded Slabs)
**Business Model:** CSFloat-Inspired Low-Fee (2.0% Marketplace Commission + Site Wallet Architecture)

## 1. Executive Summary

AuctionHous - TCG is a peer-to-peer (P2P) marketplace and live auction platform designed to disrupt incumbent platforms (TCGplayer, eBay) by cutting seller commissions from ~13.25% down to 2.0%.

By utilizing a pre-funded Site Wallet system for buyers and automated escrow holds for sellers, AuctionHous - TCG decouples credit card transaction costs from individual item sales. This structure makes high-volume sales profitable across all tiers—from $0.50 bulk singles and new competitive staples (e.g., Riftbound, Lorcana) to $10,000 graded sports slabs.

## 2. Revenue & Financial Model

### 2.1 The Fee Breakdown

```
[ Buyer Payment ] ---> [ Wallet Deposit Fee ] ---> [ Site Wallet ]
                                                          |
                                           (P2P Purchase / Auction)
                                                          |
                                            [ 2% Marketplace Fee ] ---> Platform Profit
                                                          |
                                           [ Escrow Release to Seller ]
```

| Action | Fee Charged | Paid By | Purpose / Coverage |
|---|---|---|---|
| Site Wallet Deposit | Card: 2.8% + $0.30 / ACH / Debit: 0.8% ($5 cap) | Buyer | Neutralizes payment gateway fees (Stripe/Fiserv/Plaid). |
| Item Sale Commission | 2.0% Flat | Seller | Platform operating profit, server compute, hosting. |
| Platform Reserve Allocation | 0.5% (Internal from the 2% fee) | Platform | Fraud reserve pool, chargeback defense fund, shipping loss coverage. |
| Wallet Cash-Out | ACH: Free / Instant Debit: 1.5% | Seller | Covers processor fees for fast bank withdrawals. |

## 3. Core Operational Architecture

To make low-fee sales viable for physical cards, AuctionHous - TCG operates under an Escrow-Based Peer-to-Peer (P2P) Protocol.

```
┌─────────────┐       1. Bids / Buys (Wallet)       ┌───────────────────┐
│    Buyer    │ ─────────────────────────────────► │ AuctionHous - TCG │
└─────────────┘                                     │      Escrow       │
       │                                            └───────────────────┘
       │ 3. Ships Card (Tracked/PWE)                          ▲
       ▼                                                      │ 2. Alerts Seller
┌─────────────┐                                               │    to Ship
│   Seller    │ ──────────────────────────────────────────────┘
└─────────────┘
```

### Step-by-Step Purchase Flow

1. **Fund Wallet:** Buyer deposits $50 into their site wallet (paying the payment gateway charge upfront).
2. **Purchase / Win Auction:** Buyer bids on a $0.50 Riftbound single or $200 graded sports card. Winning locks the funds in the Platform Escrow State.
3. **Fulfillment Window:**
   - Items > $20: Seller must ship within 3 business days using tracked shipping (USPS Ground Advantage).
   - Items < $20: Seller can ship using Plain White Envelope (PWE) with basic tracking (e.g., Pitney Bowes / Metered Mail) or tracked mail.
4. **Escrow Release:**
   - Tracked Packages: Funds release 24 hours after delivery confirmation.
   - PWE / Untracked Bulk: Funds release automatically 6 business days after the seller marks "Shipped" (unless a buyer dispute is opened).

## 4. Trust, Safety & Anti-Fraud Infrastructure

With a tight 2.0% margin, customer service overhead must be minimized through strict, automated seller tiers and dispute holds.

### 4.1 Seller Tier System

```
                  ┌──────────────────────┐
                  │    Tier 3: Verified  │
                  │   Instant Escrow     │
                  └──────────────────────┘
                             ▲
                             │ 100+ Sales & <1% Dispute Rate
                  ┌──────────────────────┐
                  │    Tier 2: Trusted   │
                  │   24hr Delivery Hold │
                  └──────────────────────┘
                             ▲
                             │ 10 Successful Sales
                  ┌──────────────────────┐
                  │   Tier 1: Probation  │
                  │  Strict Escrow Hold  │
                  └──────────────────────┘
```

**Tier 1: Probationary Sellers (0–10 Sales)**
- Funds held in escrow for 72 hours post-delivery.
- Maximum $200 active listing cap.
- Mandatory tracked shipping on all items.

**Tier 2: Trusted Sellers (10–100 Sales, >98% Positive Rating)**
- Standard 24-hour post-delivery escrow release.
- PWE shipping permitted for items under $20.
- $5,000 listing volume cap.

**Tier 3: Verified Power Sellers (100+ Sales, >99% Positive Rating, ID Verified)**
- Instant Escrow Release upon carrier scan.
- Unlimited listing cap.
- Access to bulk CSV/API listing engines.

### 4.2 Account Hold & Fraud Prevention Triggers

**Automated Freeze Rules:**
- **The "Dispute Freeze":** If a buyer files a fraud claim (e.g., "Received Wrong Card" or "Fake Slab"), both the sale funds and the equivalent amount in the seller's wallet are immediately frozen until resolved.
- **The Bad Actor Threshold:** Any account accumulating 2 active disputes in 30 days or falling below a 95% feedback score has listing privileges automatically suspended pending manual compliance review.
- **New Account Withdrawal Delay:** Sellers must wait 5 business days after their first sale before performing their first external bank withdrawal.

## 5. System Features: Bulk Singles vs. High-End Cards & Sports Slabs

| Feature | Low-Value Singles ($0.50 – $19.99) (Riftbound, MTG, Pokémon) | High-End Slabs & Sports Grails ($20.00+) (PSA/BGS Slabs, Vintage Raw) |
|---|---|---|
| Checkout Mode | Batching/Cart Required: Minimum order size of $3.00 across sellers or single-seller store carts. | Individual Buy-It-Now or Live Auction. |
| Shipping Standard | PWE (Plain White Envelope) or Rigid Mailer. | Mandatory Bubble Mailer / Box + Full Tracking. |
| Card Condition Verification | High-Res Front/Back Photo required (AI condition suggestion tool). | High-Res Scan + Cert Number API verification (PSA/BGS/CGC). |
| Vault Option | N/A | Optional "Ship to Platform Vault" for instant zero-shipping resale. |

## 6. Dispute Resolution Protocol

```
[ Dispute Initiated ]
         │
         ├──► 1. Buyer & Seller Direct Negotiation Window (48 Hours)
         │         │
         │         ├──► Resolved: Dispute Closed
         │         └──► Unresolved: Escalates to Support
         │
         └──► 2. Automated Admin Audit
                   ├── Check Tracking Metrics
                   ├── Check Card Cert / High-Res Uploads
                   └── Decision Rendered (Funds Refunded or Released)
```

1. **48-Hour Resolution Window:** Buyer and seller are placed in a direct, private ticket thread to resolve minor issues (e.g., partial refunds for minor condition mismatch).
2. **Escalation to Platform:** If unresolved, an admin reviews uploaded photo evidence against the original listing photos.
3. **Fraud Penalty:** If a seller is found intentionally sending counterfeit cards or empty packages:
   - Account permanently banned.
   - Wallet balance liquidated to refund the buyer.
   - Address / Identity blacklisted across payment processors.

## 7. Recommended Tech Stack

- **Frontend:** Next.js (React), Tailwind CSS (Fast, SEO-optimized for Google indexing of card listings).
- **Backend / API:** Go (Golang) or Node.js/NestJS (High-throughput for real-time auction bidding engines).
- **Database:** PostgreSQL (Primary transactional DB) + Redis (Real-time auction timer state and wallet locks).
- **Payment Infrastructure:** Stripe Connect / Plaid (Wallet deposit and ACH payout rails).
- **Media Hosting:** Cloudflare R2 / AWS S3 + Image Optimization pipeline (Fast card scan image delivery).
