# AuctionHous - TCG

P2P auction and fixed-price marketplace for trading cards and graded slabs.
2% marketplace commission via a pre-funded site wallet + escrow architecture,
instead of the ~13.25% incumbent platforms charge.

- **Business model / fees / escrow timers / seller tiers:** [`docs/design-doc.md`](docs/design-doc.md)
- **Architecture, domain model, and how each subsystem maps to proven eBay
  mechanics:** [`CLAUDE.md`](CLAUDE.md)

## Repo layout

```
apps/web/                  Next.js frontend
apps/api/                  Go backend (single module, internal/ per domain)
packages/shared-contracts/ OpenAPI spec — source of truth for the web<->api contract
infra/docker-compose.yml   Postgres/Redis/MinIO for local self-hosting (unused for now — see below)
docs/design-doc.md         Business design doc
docs/infra-cost-analysis.html  Why Supabase — full hosting cost comparison
```

## Local development

This currently targets a real (free-tier) Supabase project directly — see CLAUDE.md
§10 for one-time setup (create the project, copy env vars, run migrations).
`infra/docker-compose.yml` is unused until/unless you self-host instead.

Run the backend (health check at `http://localhost:8080/healthz`; `/me` once Supabase
is configured):

```bash
cd apps/api && go run ./cmd/api
```

Run the frontend (homepage, `/signup`, `/login`, `/listing/[id]`):

```bash
cd apps/web && npm run dev
```

## Status

Homepage/listing UI and account creation (Supabase Auth) are wired up. See CLAUDE.md
§8 for what's actually in scope for v1 vs. deliberately deferred to later.
