import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SellWizard from "@/components/SellWizard";
import SellerPayoutsSetup from "@/components/SellerPayoutsSetup";
import { getSellerConnectStatus, type SellerConnectStatus } from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { isStripeConfigured } from "@/lib/stripe";
import { getCurrentSession } from "@/lib/session";

export default async function SellPage() {
  if (!isSupabaseConfigured()) {
    redirect("/login");
  }

  // getCurrentSession() is cache()'d — Header (rendered below) calls it
  // too, so this shares that one call instead of paying for a second,
  // separate round trip to Supabase's Auth server just to check login.
  const { session, user } = await getCurrentSession();

  if (!user || !session) {
    redirect("/login");
  }

  // Gated server-side, not just a UI nicety: apps/api/internal/listing.
  // Create rejects the actual POST /listings call too
  // (RequireSellerOnboarded) if Stripe is configured and this seller
  // hasn't finished Connect onboarding — a direct API call can't bypass
  // this prompt, only skip seeing it. Skipped entirely when Stripe isn't
  // configured at all (local dev without keys), same graceful-degradation
  // posture as everywhere else Stripe is optional in this codebase.
  let connectStatus: SellerConnectStatus | null = null;
  if (isStripeConfigured()) {
    connectStatus = await getSellerConnectStatus(session.access_token).catch(() => null);
  }
  const needsOnboarding = connectStatus !== null && !connectStatus.chargesEnabled;

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header variant="logo-only" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-10 py-10 sm:px-12 lg:px-14">
        <h1 className="text-3xl font-bold text-gray-900">Create a listing</h1>
        <p className="mt-1.5 text-base text-gray-500">
          List a card as an auction or a fixed-price Buy It Now.
        </p>

        {needsOnboarding && connectStatus ? (
          <div className="mt-6 rounded-2xl border border-brand-border bg-white p-8">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-surface text-brand-navy">
                <ShieldCheck size={16} />
              </span>
              <h2 className="text-lg font-semibold text-gray-900">
                Set up payouts before you list
              </h2>
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Before anyone can buy from you, Stripe needs to verify where your sale proceeds
              actually go — a one-time, few-minute setup. We never hold your money ourselves; this
              is the identity check that lets Stripe pay you directly the moment something sells.
            </p>
            <SellerPayoutsSetup initialStatus={connectStatus} returnPath="/sell" />
          </div>
        ) : (
          <SellWizard />
        )}
      </main>
      <Footer />
    </div>
  );
}
