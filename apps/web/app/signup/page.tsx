import Header from "@/components/Header";
import Footer from "@/components/Footer";
import SignUpForm from "@/components/SignUpForm";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col bg-brand-surface">
      <Header />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-10 py-16">
        <h1 className="text-2xl font-bold text-gray-900">Create your account</h1>
        <p className="mt-1 text-sm text-gray-500">
          Buy and sell trading cards with 2% seller fees and escrow protection.
        </p>
        <SignUpForm />
      </main>
      <Footer />
    </div>
  );
}
