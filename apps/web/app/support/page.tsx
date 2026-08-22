import Link from "next/link";
import { FileWarning, Mail, Wrench } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Support | AuctionHous - TCG",
};

const OPTIONS = [
  {
    href: "/support/claim",
    icon: FileWarning,
    title: "File a Claim",
    description: "Item not as described, never arrived, or damaged in transit.",
  },
  {
    href: "/support/contact",
    icon: Mail,
    title: "Contact Support",
    description: "Reach a human for anything account, listing, or order related.",
  },
  {
    href: "/support/troubleshoot",
    icon: Wrench,
    title: "Troubleshoot",
    description: "Common fixes for bidding, payments, and shipping issues.",
  },
] as const;

export default function SupportPage() {
  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-10 py-16 sm:px-12 lg:px-14">
        <h1 className="text-2xl font-bold text-gray-900">How can we help?</h1>
        <p className="mt-2 text-sm text-gray-600">
          Pick the option that best matches what you need.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {OPTIONS.map(({ href, icon: Icon, title, description }) => (
            <Link
              key={href}
              href={href}
              className="group flex flex-col items-center gap-3 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-brand-border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-navy/10 text-brand-navy transition-colors group-hover:bg-brand-navy group-hover:text-white">
                <Icon size={26} />
              </span>
              <span className="text-base font-bold text-gray-900">{title}</span>
              <span className="text-xs text-gray-500">{description}</span>
            </Link>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}
