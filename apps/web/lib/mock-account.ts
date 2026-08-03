// Sold History, Buy History, and Messages remain placeholder data — there's
// no real Order or messaging backend yet (CLAUDE.md §8: v1 scope still
// pending). Buying, Selling, and Bids/Offers are real now (see lib/api.ts).
//
// These entries are deliberately flat data, not clickable Listing records —
// there's no real listing behind them to link to, so this doesn't pretend
// there is one.

export interface HistoryItem {
  title: string;
  game: string;
  set: string;
  priceCents: number;
  counterpartyName: string;
  date: string; // ISO date
}

export const mySoldHistory: HistoryItem[] = [
  {
    title: "Dark Magician Girl - Ultra Rare",
    game: "Yu-Gi-Oh!",
    set: "Magician's Force",
    priceCents: 7499,
    counterpartyName: "card_collector_22",
    date: "2026-07-10",
  },
];

export const myBuyHistory: HistoryItem[] = [
  {
    title: "Elsa - Snow Queen (Enchanted)",
    game: "Disney Lorcana",
    set: "The First Chapter",
    priceCents: 28999,
    counterpartyName: "inkwell_traders",
    date: "2026-06-28",
  },
];

export interface MessageThread {
  id: string;
  from: string;
  preview: string;
  date: string; // ISO date
  unread: boolean;
}

export const myMessages: MessageThread[] = [
  {
    id: "m1",
    from: "vault_collectibles",
    preview: "Thanks for your bid! I'll ship within 1 business day of the auction closing.",
    date: "2026-07-26",
    unread: true,
  },
  {
    id: "m2",
    from: "AuctionHous Support",
    preview: "Your dispute on order #A1092 has been resolved in your favor.",
    date: "2026-07-20",
    unread: false,
  },
  {
    id: "m3",
    from: "inkwell_traders",
    preview: "Shipped! Tracking number: 9400111899223347...",
    date: "2026-06-29",
    unread: false,
  },
];
