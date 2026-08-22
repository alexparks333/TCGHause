import { loadStripe, type Stripe } from "@stripe/stripe-js";

// Stripe isn't configured until a TEST-mode publishable key is set (see
// apps/web/.env.example) — same graceful-degradation pattern as
// isSupabaseConfigured(). MockCheckout checks this before rendering the
// real Stripe Elements form, falling back to the plain mock-payment
// button otherwise, so the checkout page works either way.
export function isStripeConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
}

// loadStripe() is meant to be called once and reused — it dynamically
// injects Stripe.js, so repeating it per-render would inject the script
// again on every mount. A single platform-only instance is correct now:
// every checkout PaymentIntent lives on the platform's own Stripe account
// under separate charges and transfers (docs/Legal_MoneyTransitter.md), not
// a seller's connected account, so there's no per-seller account context
// to initialize against anymore (that used to matter for a direct charge —
// see this file's git history / TASKS-TODO.md for the "loaderror" bug that
// caused).
let stripePromise: Promise<Stripe | null> | undefined;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "");
  }
  return stripePromise;
}
