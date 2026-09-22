// Thin client for the Shopify *Partner* API — a separate API from the
// per-shop Admin API, authenticated with an org-level Partner API access
// token rather than a shop's session. See app/models/billing.server.ts for
// why this app needs it at all.
const PARTNER_API_VERSION = "2026-07";

export type ActiveSubscription = {
  cancelAtEndOfCycle: boolean;
  trialEndsAt: string | null;
  items: { handle: string; description: string | null }[];
};

// Returns the shop's active Shopify App Pricing subscription, or null if it
// has none (i.e. it's on the free plan) — or if the Partner API client
// hasn't been configured yet (e.g. local dev without the env vars set),
// in which case the caller should treat this as "unknown" and fall back to
// another signal rather than assuming free.
export async function fetchActiveSubscription(
  shopId: string,
): Promise<ActiveSubscription | null> {
  const orgId = process.env.SHOPIFY_PARTNER_ORG_ID;
  const token = process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN;
  const appGid = process.env.SHOPIFY_APP_GID;

  if (!orgId || !token || !appGid) {
    return null;
  }

  const res = await fetch(
    `https://partners.shopify.com/${orgId}/api/${PARTNER_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: `#graphql
          query ActiveSubscription($appId: ID!, $shopId: ID!) {
            activeSubscription(appId: $appId, shopId: $shopId) {
              cancelAtEndOfCycle
              trialEndsAt
              items {
                handle
                description
              }
            }
          }`,
        variables: { appId: appGid, shopId },
      }),
    },
  );

  const { data, errors } = (await res.json()) as {
    data?: { activeSubscription: ActiveSubscription | null };
    errors?: unknown;
  };

  // Throw rather than silently treating a throttled/failed request as "no
  // subscription" — that would incorrectly downgrade a paying merchant to
  // free. The Partner API allows 4 requests/second per client.
  if (!res.ok || errors) {
    throw new Error(
      `Partner API request failed: ${JSON.stringify(errors ?? res.status)}`,
    );
  }

  // null is the expected, valid response when the shop has no Shopify App
  // Pricing contract for this app (i.e. it's genuinely on the free plan).
  return data?.activeSubscription ?? null;
}
