import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import ClaimStart from "@/components/ClaimStart";
import { getCurrentSession } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";

export const metadata = {
  title: "File a Claim | AuctionHous - TCG",
};

export default async function FileClaimPage() {
  // Server-fetched, same as every other auth-gated surface in this codebase
  // (CLAUDE.md §6.13's "no client-only initial state" rule) — ClaimStart
  // gets a real isLoggedIn on first render instead of guessing client-side
  // and flashing a login prompt for a user who's actually signed in.
  const { session } = isSupabaseConfigured() ? await getCurrentSession() : { session: null };

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />
      <main className="mx-auto w-full max-w-xl flex-1 px-10 py-16 sm:px-12 lg:px-14">
        <Link href="/support" className="text-xs font-medium text-brand-navy hover:underline">
          &larr; Back to Support
        </Link>

        <h1 className="mt-3 text-2xl font-bold text-gray-900">File a Claim</h1>
        <p className="mt-2 text-sm text-gray-600">
          Pick which side of the order you&apos;re on, then choose the order it concerns — every
          claim gets its own ticket number you can reference with support.
        </p>

        <ClaimStart isLoggedIn={!!session} />

        <p className="mt-6 text-xs text-gray-400">
          Can&apos;t find the order, or the issue isn&apos;t tied to a specific order? Use{" "}
          <Link href="/support/contact" className="text-brand-navy hover:underline">
            Contact Support
          </Link>{" "}
          instead.
        </p>
      </main>
      <Footer />
    </div>
  );
}
