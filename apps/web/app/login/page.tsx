import Header from "@/components/Header";
import Footer from "@/components/Footer";
import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-10 py-16">
        <h1 className="text-2xl font-bold text-gray-900">Sign in</h1>
        <p className="mt-1 text-sm text-gray-500">Welcome back to AuctionHous - TCG.</p>
        <LoginForm />
      </main>
      <Footer />
    </div>
  );
}
