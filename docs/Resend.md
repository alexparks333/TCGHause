# Resend — Claims Human-Review Email Notification

**Status:** built and live. `internal/mail` sends exactly one real email today —
alerting `support@auctionhous.net` when a claim escalates to `human_review` (see
CLAUDE.md §6.17). This doc is the setup/runbook for that integration, not a research
doc — the account exists, the domain is verified, and it has been tested end-to-end
against a real inbox.

---

## 1. What this is for, and what it deliberately isn't

Most claims never need a human: they resolve through direct negotiation or
auto-adjudication (`internal/dispute.autoAdjudicate`, design doc v2 §9.1) without
anyone at support touching them. The one moment that genuinely needs a person is a
claim landing in `human_review` — no auto-adjudication rule matched it, and it's now
sitting in the Workers-side claims queue waiting for a decision.

That single transition is the *only* trigger for a Resend email. This was a deliberate
choice, not an oversight — emailing support on every claim opened would flood the
inbox and defeat the point of the negotiation/auto-adjudication system that resolves
most claims without any human involvement at all.

**Not built:** order confirmations, shipping updates, or any other transactional email.
Resend is wired for this one notification only; extending it to other emails is real,
separate future work (see §5 below for how to do that without re-deriving this setup).

---

## 2. Where the code lives

- `internal/mail/mail.go` — the `Client`, wrapping the official `resend-go/v2` SDK.
  Nil-safe (`IsConfigured()`), same graceful-degradation pattern as
  `payment.Client`/`shipping.Client` — no `RESEND_API_KEY` means the send is silently
  skipped, not a boot failure.
- `internal/dispute/claim.go`'s `Escalate()` → on landing in `StateHumanReview`, calls
  `notifyHumanReview()`, which builds the subject/HTML and calls `mailClient.Send`.
- **Two real call sites reach `Escalate()`:** the buyer/seller-facing "Escalate this
  claim" button (`POST /claims/{id}/escalate`), and — the one that actually matters in
  production — `cmd/worker/claim_timer.go`'s 48-hour auto-escalation loop. A human
  clicking "escalate" faster than the 48h timer is the exception, not the rule.
- A failed send is logged (`log.Printf`), never returned as an error — the claim having
  already landed in `human_review` is the real event and must stand regardless of
  whether the email happens to go out. Same reasoning as `releaseOrder`'s Transfer
  failure elsewhere in the same file.

---

## 3. Account setup (already done, documented for reference/rebuild)

1. **Resend account** signed up at resend.com under `alexhparks@gmail.com`. (Business
   accounts you don't want tied to a personal email are a "someday" cleanup, not
   urgent — see chat history; Resend lets you change the account owner later.)
2. **Domain verification**: Resend → Domains → Add Domain → `auctionhous.net`. Resend
   returned three DNS records, all on a **`send` subdomain**, not the root domain:

   | Type | Name | Value | Priority |
   |---|---|---|---|
   | MX | `send` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |
   | TXT | `resend._domainkey` | `p=<DKIM public key>` | — |

   All three added at GoDaddy (Domain → DNS → Add Record), then verified in Resend's
   dashboard.

   **The SPF collision this avoided:** `auctionhous.net`'s root domain already has an
   SPF record from Microsoft 365 (the real `support@` mailbox) — a domain can only have
   one SPF TXT record, and a second one at the same name silently breaks it rather than
   combining. Resend's SPF record lives on `send.auctionhous.net`, a different DNS name
   entirely, so there was no conflict to merge here. **This won't always be true** —
   some providers' setup instructions do ask for a root-domain SPF entry. Always check
   which name a new SPF record targets before adding it, if the domain already sends
   mail through another provider.

3. **API key**: created in Resend → API Keys, scoped to **"Sending access" only** (not
   "Full access") — the app only ever calls `Send`, never reads logs back, so the
   narrower key is the correct least-privilege choice, not a limitation to work around.
   Stored in `apps/api/.env` as `RESEND_API_KEY`, gitignored.

---

## 4. Config (`apps/api/.env` / `.env.example`)

```
RESEND_API_KEY=re_<your-key>
CLAIMS_NOTIFY_FROM_EMAIL=AuctionHous Claims <claims@auctionhous.net>
CLAIMS_NOTIFY_TO_EMAIL=support@auctionhous.net
```

`CLAIMS_NOTIFY_FROM_EMAIL`'s address doesn't need its own real mailbox — it's only ever
a From header, authenticated by the domain-level SPF/DKIM above, not by anyone actually
reading a `claims@` inbox. `CLAIMS_NOTIFY_TO_EMAIL` is the real, human-read mailbox;
override it in local dev if you don't want test escalations actually paging support.

The email body also links into `{WEB_ORIGIN}/admin/claims/{id}` — the real Workers-side
decide screen (§6.17). **`WEB_ORIGIN` is `http://localhost:4000` in local dev**, so
right now that link only opens on the machine running the dev server. It'll resolve
correctly with zero code changes once the site is actually deployed and `WEB_ORIGIN` is
set to the real production URL — that's a separate, later piece of work (deployment),
not something broken today.

---

## 5. How this was verified end-to-end

Not just "it compiles" — the actual send was tested against a real inbox:

1. Filed a real claim (reason code that never auto-adjudicates, e.g.
   `not_as_described`, so it's guaranteed to reach `human_review`), then escalated it.
2. **Before domain verification:** the API log showed Resend's own rejection —
   `[ERROR]: The auctionhous.net domain is not verified.` — proving the code path was
   correct and only Resend's domain check was blocking it.
3. **After domain verification:** no error logged (silence = success, since this
   package only logs failures), and confirmed independently via Resend's own API
   (`GET /emails`, using a temporary full-access key, since the app's own key is
   deliberately sending-only): `"to": ["support@auctionhous.net"]`,
   `"last_event": "delivered"`.
4. Confirmed the actual email landed in the real `support@auctionhous.net` inbox
   (Outlook/GoDaddy webmail).

Test claims and their `claim_events` rows were deleted afterward, and the test
order's state was restored — nothing from this testing was left in the database.

---

## 6. If you extend this to a new email later

Don't build a second, parallel mail-sending path. `internal/mail.Client.Send(ctx,
subject, html)` is already generic — a new notification (order confirmation, shipping
update, whatever) just needs its own call site building its own subject/HTML and
calling the same `Send`. If it needs a different From/To than the claims one, that
means a second `mail.Client` instance (constructed with its own from/to), not a new
package.
