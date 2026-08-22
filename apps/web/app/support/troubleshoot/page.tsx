import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Troubleshoot | AuctionHous - TCG",
};

export default function TroubleshootPage() {
  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />
      <main className="mx-auto w-full max-w-xl flex-1 px-10 py-16 sm:px-12 lg:px-14">
        <Link href="/support" className="text-xs font-medium text-brand-navy hover:underline">
          &larr; Back to Support
        </Link>

        <h1 className="mt-3 text-2xl font-bold text-gray-900">Troubleshoot</h1>
        <p className="mt-2 text-sm text-gray-600">
          Self-serve fixes for common bidding, payment, and shipping issues are coming soon. In
          the meantime, a real person can help.
        </p>

        <Link
          href="/support/contact"
          className="mt-6 inline-block rounded-full bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-navy-light"
        >
          Contact Support
        </Link>
      </main>
      <Footer />
    </div>
  );
}
