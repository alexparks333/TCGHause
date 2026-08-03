import { redirect } from "next/navigation";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SellWizard from "@/components/SellWizard";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";

export default async function SellPage() {
  if (!isSupabaseConfigured()) {
    redirect("/login");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />
      <main className="mx-auto w-full max-w-2xl flex-1 px-10 py-10 sm:px-12 lg:px-14">
        <h1 className="text-2xl font-bold text-gray-900">Create a listing</h1>
        <p className="mt-1 text-sm text-gray-500">
          List a card as an auction or a fixed-price Buy It Now.
        </p>
        <SellWizard />
      </main>
      <Footer />
    </div>
  );
}
