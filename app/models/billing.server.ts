import db from "../db.server";
import { fetchActiveSubscription } from "../partner-api.server";
import { PRO_PLAN } from "../shopify.server";

type AdminClient = { graphql: (query: string) => Promise<Response> };
type BillingClient = {
  check: (args: {
    plans: (typeof PRO_PLAN)[];
  }) => Promise<{ hasActivePayment: boolean }>;
};

// This app is sold through Shopify App Pricing (formerly "Managed
// Pricing"): merchants pick/cancel plans on Shopify's own hosted page, and
// this app never calls billing.request()/billing.cancel(). Because of that,
// the *Admin* API's currentAppInstallation.activeSubscriptions — which is
// what shopify-app-react-router's billing.check() reads — does not reflect
// Shopify App Pricing subscriptions. Shopify's docs are explicit about this:
// query `activeSubscription` on the *Partner* API instead
// (https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing).
//
// This was the cause of App Store review rejection 1.2.2: billing.check()
// always returned hasActivePayment: false regardless of the merchant's
// actual (Shopify App Pricing) plan, so the app permanently showed "Free".
//
// billing.check() is still consulted as a secondary signal, per Shopify's
// migration guidance, since it *does* catch a leftover Billing API
// subscription or one-time purchase from before this app existed/switched
// to Shopify App Pricing.
//
// Determines the shop's current plan, caches it on the Shop row (drives the
// free-tier order cap and the storefront widget's "Powered by" badge), and
// returns it.
export async function syncShopPlan(params: {
  shopDomain: string;
  admin: AdminClient;
  billing: BillingClient;
}): Promise<"free" | "pro"> {
  const { shopDomain, admin, billing } = params;

  let hasActivePayment = false;
  try {
    const shopResponse = await admin.graphql(`#graphql
      { shop { id } }
    `);
    const { data } = (await shopResponse.json()) as {
      data?: { shop?: { id?: string } };
    };
    const shopId = data?.shop?.id;
    if (shopId) {
      const subscription = await fetchActiveSubscription(shopId);
      hasActivePayment = Boolean(subscription);
    }
  } catch (error) {
    // Don't let a Partner API hiccup (throttling, misconfigured env vars,
    // network error) incorrectly downgrade a paying merchant — fall through
    // to the billing.check() fallback below instead.
    console.error("[packpost] Partner API active-subscription check failed", error);
  }

  if (!hasActivePayment) {
    const billingCheck = await billing.check({ plans: [PRO_PLAN] });
    hasActivePayment = billingCheck.hasActivePayment;
  }

  const plan = hasActivePayment ? "pro" : "free";
  await db.shop.update({
    where: { shopDomain },
    data: { plan, hideBranding: hasActivePayment },
  });

  return plan;
}
