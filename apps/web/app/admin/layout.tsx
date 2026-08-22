import Link from "next/link";
import { redirect } from "next/navigation";
import AdminSidebarNav from "@/components/AdminSidebarNav";
import { getLocalSession } from "@/lib/session";

// The Workers side's own shell — deliberately NOT the marketplace's
// <Header />/<Footer /> (no search bar, no category nav, no Sell button).
// This is an internal tool, not another page of the storefront, so it
// gets its own chrome: a fixed dark sidebar instead of the site's top nav.
// Wraps every /admin/* route (metrics, claims, claims/[id], and whatever
// gets added next) — the auth redirect lives here once instead of
// repeated in every page.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const local = await getLocalSession();
  if (!local) redirect("/login");

  return (
    <div className="flex min-h-screen bg-brand-surface">
      <aside className="flex w-56 shrink-0 flex-col bg-brand-navy">
        <div className="px-5 py-6">
          <p className="text-lg font-bold text-white">AuctionHous</p>
          <p className="text-xs font-semibold tracking-wide text-white/50 uppercase">Workers</p>
        </div>
        <AdminSidebarNav />
        <div className="border-t border-white/10 px-3 py-4">
          <Link
            href="/"
            className="block rounded-lg px-3 py-2 text-xs font-medium text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            &larr; Back to site
          </Link>
        </div>
      </aside>
      <div className="flex-1 overflow-x-auto px-10 py-12 sm:px-12 lg:px-14">{children}</div>
    </div>
  );
}
