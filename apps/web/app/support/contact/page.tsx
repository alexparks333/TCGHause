import Link from "next/link";
import { Mail } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Contact Support | AuctionHous - TCG",
};

export default function ContactSupportPage() {
  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />
      <main className="mx-auto w-full max-w-xl flex-1 px-10 py-16 sm:px-12 lg:px-14">
        <Link href="/support" className="text-xs font-medium text-brand-navy hover:underline">
          &larr; Back to Support
        </Link>

        <h1 className="mt-3 text-2xl font-bold text-gray-900">Contact Support</h1>
        <p className="mt-2 text-sm text-gray-600">
          For anything account, listing, or order related, email us directly and a real person
          will get back to you.
        </p>

        <a
          href="mailto:support@auctionhous.net"
          className="mt-6 flex items-center gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-brand-border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-navy/10 text-brand-navy">
            <Mail size={22} />
          </span>
          <span>
            <span className="block text-sm font-bold text-gray-900">support@auctionhous.net</span>
            <span className="block text-xs text-gray-500">Click to open your email app</span>
          </span>
        </a>

        <p className="mt-6 text-xs text-gray-400">
          Reporting a problem with a specific order? Filing directly from that order gives us the
          most context — see{" "}
          <Link href="/support/claim" className="text-brand-navy hover:underline">
            File a Claim
          </Link>{" "}
          instead.
        </p>
      </main>
      <Footer />
    </div>
  );
}
