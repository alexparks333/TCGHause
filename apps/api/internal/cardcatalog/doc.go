// Package cardcatalog is a read-only mirror of TCG Haven's card database —
// a separate app on the same author's machine that already maintains a
// multi-game (Pokémon/Lorcana/Riftbound) card catalog in Firestore, scraped
// from upstream sources and admin-curated (see that project's own
// "Admin Catalog — Complete System Reference" doc). Rather than duplicate
// that scraping/curation work, this package reads it directly, over the
// Firestore Admin SDK, using a service account scoped to
// roles/datastore.viewer — read-only at the IAM level.
//
// This is what powers the Sell wizard's "search for your card" autofill
// (GET /catalog/search) — a seller listing a Pokémon/Lorcana/Riftbound card
// can find it by name and have Set/Number/Rarity filled in automatically,
// instead of hand-typing them. MTG, Yu-Gi-Oh!, and Sports Cards have no
// TCG Haven catalog to draw from, so those games just get no suggestions —
// see gameSlug in games.go.
//
// Trust boundary, worth being explicit about: Firestore IAM roles aren't
// collection-scoped, so the datastore.viewer service account can technically
// read any collection in TCG Haven's project, including its per-user
// inventory data — Firestore Security Rules (which do scope by collection)
// only apply to client-SDK/end-user reads, not to a service account using
// the Admin SDK. The actual boundary here is this package's own code: it
// only ever queries the fixed collection names below, never a caller-
// supplied path. Mirrors how apps/api's own Postgres connection uses the
// `postgres` role and bypasses Supabase RLS by design (CLAUDE.md §6.12) —
// the trust is pushed into this codebase, not enforced by the remote store.
//
// This package never writes anything — TCG Haven's Admin Catalog UI remains
// the only writer of its own data.
package cardcatalog
