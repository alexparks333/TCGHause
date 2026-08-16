import { loadStripe, type Stripe } from "@stripe/stripe-js";

// Stripe isn't configured until a TEST-mode publishable key is set (see
// apps/web/.env.example) — same graceful-degradation pattern as
// isSupabaseConfigured(). MockCheckout checks this before rendering the
// real Stripe Elements form, falling back to the plain mock-payment
// button otherwise, so the checkout page works either way.
export function isStripeConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
}

// loadStripe() is meant to be called once per distinct config and reused
// — it dynamically injects Stripe.js, so repeating it per-render would
// inject the script again on every mount. Keyed by connected account id
// (empty string for the platform-only, no-Connect-account case) because a
// Stripe.js instance is bound to whichever account it was initialized
// with: a direct charge's PaymentIntent (design doc v2 §5.3) lives on the
// SELLER's connected account, not the platform account, and Stripe.js
// silently fails to load a Payment Element for a clientSecret from a
// different account context ("loaderror", no useful message) — this was a
// real bug, a single memoized platform-only instance, before every
// checkout started passing its seller's stripeAccountId here. See
// CheckoutIntent.stripeAccountId and TASKS-TODO.md.
const stripePromises = new Map<string, Promise<Stripe | null>>();

export function getStripe(stripeAccountId?: string): Promise<Stripe | null> {
  const key = stripeAccountId ?? "";
  let promise = stripePromises.get(key);
  if (!promise) {
    const options = stripeAccountId ? { stripeAccount: stripeAccountId } : undefined;
    promise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "", options);
    stripePromises.set(key, promise);
  }
  return promise;
}
