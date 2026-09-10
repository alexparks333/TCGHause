import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import EditListingForm from "@/components/EditListingForm";
import { getListing } from "@/lib/api";
import { getLocalSession } from "@/lib/session";

// The Selling page's "Edit Listing" (⋮ menu, ListingCard's ownerMenu) —
// deliberately not a rebuild of the multi-step Sell wizard. Looks like it
// (same page chrome, same FormSection/MoneyInput visual language as
// Step3Price) but everything except pricing/offers renders read-only: the
// card identity, condition, photos, shipping preset, and — critically —
// the auction's starting bid and end time are all fixed the moment a
// listing goes live and a bidder might already be relying on them. See
// apps/api/internal/listing.UpdateInput's own doc comment for the backend
// side of this same boundary.
export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [listing, local] = await Promise.all([getListing(id), getLocalSession()]);
  if (!listing) notFound();

  // Not a 404 for a non-owner — the listing itself is real and publicly
  // visible at /listing/{id} (GET /listings/{id} has no auth gate), so
  // there's nothing to hide by existence; there's just no edit form for
  // someone who isn't the seller. Sends them to the page they'd actually
  // expect instead.
  if (local?.userId !== listing.sellerId) {
    redirect(`/listing/${id}`);
  }

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header variant="logo-only" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-10 py-10 sm:px-12 lg:px-14">
        <Link
          href="/account/selling"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-brand-navy"
        >
          <ArrowLeft size={15} /> Back to Selling
        </Link>
        <h1 className="mt-3 text-3xl font-bold text-gray-900">Edit listing</h1>
        <p className="mt-1.5 text-base text-gray-500">
          Only pricing and offers can change once a listing is live.
        </p>

        {listing.status !== "active" ? (
          <div className="mt-6 rounded-2xl border border-brand-border bg-white p-8">
            <p className="text-sm text-gray-600">
              This listing is no longer active, so there&apos;s nothing left to edit.
            </p>
            <a
              href="/account/selling"
              className="mt-3 inline-block text-sm font-semibold text-brand-navy hover:underline"
            >
              Back to Selling
            </a>
          </div>
        ) : (
          <EditListingForm listing={listing} />
        )}
      </main>
      <Footer />
    </div>
  );
}
