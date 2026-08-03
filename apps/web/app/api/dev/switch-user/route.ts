import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type AccountKey = "seller" | "bidderA" | "bidderB";

function credentialsFor(account: AccountKey): { email: string; password: string } | null {
  const pairs: Record<AccountKey, [string | undefined, string | undefined]> = {
    seller: [process.env.DEV_ACCOUNT_SELLER_EMAIL, process.env.DEV_ACCOUNT_SELLER_PASSWORD],
    bidderA: [process.env.DEV_ACCOUNT_BIDDER_A_EMAIL, process.env.DEV_ACCOUNT_BIDDER_A_PASSWORD],
    bidderB: [process.env.DEV_ACCOUNT_BIDDER_B_EMAIL, process.env.DEV_ACCOUNT_BIDDER_B_PASSWORD],
  };
  const [email, password] = pairs[account] ?? [];
  return email && password ? { email, password } : null;
}

// Dev-only: signs in as a pre-seeded real test account via real Supabase
// auth, so switching identities to test bidding doesn't require the
// log-out/log-in dance. This is not an impersonation backdoor — it never
// weakens auth, it just automates a normal sign-in with real credentials
// that only exist locally (see .env.example). Refuses to run at all outside
// development, independent of whether the panel that calls it is rendered.
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const account = body?.account as AccountKey | undefined;
  if (!account) {
    return NextResponse.json({ error: "missing account" }, { status: 400 });
  }

  const creds = credentialsFor(account);
  if (!creds) {
    return NextResponse.json(
      {
        error: `DEV_ACCOUNT_* env vars not set for "${account}" — see apps/web/.env.example`,
      },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(creds);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
