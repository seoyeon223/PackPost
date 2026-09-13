import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  ensureOrderTimeline,
  findPublicTimeline,
  logLookupMiss,
  normalizeOrderName,
} from "../models/timeline.server";

// Reached via Shopify App Proxy at https://<shop-domain>/apps/packpost/status
// (same-origin from the storefront's point of view, so no CORS/API key needed).
// authenticate.public.appProxy verifies Shopify's HMAC signature on the request.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const orderName = url.searchParams.get("order");
  const email = url.searchParams.get("email");

  if (!orderName || !email) {
    return Response.json({ error: "missing_params" }, { status: 400 });
  }

  let result = await findPublicTimeline({
    shopDomain: session.shop,
    orderName,
    email,
  });

  // Nothing tracked locally yet — this happens for any order that predates
  // the orders/create webhook actually being live, or that the seller never
  // ran a manual sync for (e.g. a buyer's very first visit right after an
  // order is placed). Fall back to a live Admin API lookup so the widget
  // still works instead of depending on a prior sync.
  if (!result) {
    const normalizedName = normalizeOrderName(orderName);
    const response = await admin.graphql(
      `#graphql
        query FindOrderByName($query: String!) {
          orders(first: 1, query: $query) {
            edges {
              node {
                id
                name
                email
              }
            }
          }
        }`,
      { variables: { query: `name:'${normalizedName}'` } },
    );
    const json = await response.json();
    const order = json.data?.orders?.edges?.[0]?.node as
      | { id: string; name: string; email?: string | null }
      | undefined;

    const orderEmail = order?.email?.trim().toLowerCase();
    if (order && orderEmail && orderEmail === email.trim().toLowerCase()) {
      const created = await ensureOrderTimeline({
        shopDomain: session.shop,
        shopifyOrderId: order.id.split("/").pop()!,
        orderName: order.name,
        customerEmail: order.email,
      });
      if (created) {
        result = await findPublicTimeline({
          shopDomain: session.shop,
          orderName,
          email,
        });
      }
    }
  }

  if (!result) {
    await logLookupMiss(session.shop, orderName, email);
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json(result);
};
