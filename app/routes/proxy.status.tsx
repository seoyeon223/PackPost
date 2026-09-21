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
    try {
      // Order name search takes the bare number ("1001"); the "#" prefix (and
      // any quoting) makes the search syntax unreliable across stores. The
      // `email` filter is a real search field on Order (matches the order's
      // contact email), so we can narrow to this buyer's order server-side
      // without needing the `customer { ... }` field — that field requires
      // the read_customers scope, which this app doesn't request.
      const bareName = normalizeOrderName(orderName).replace(/^#/, "");
      const escapedEmail = email.trim().replace(/"/g, '\\"');
      const searchQuery = `name:${bareName} email:"${escapedEmail}"`;
      const response = await admin.graphql(
        `#graphql
          query FindOrderByNameAndEmail($query: String!) {
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
        { variables: { query: searchQuery } },
      );
      const json = await response.json();
      const graphqlErrors = (json as { errors?: unknown }).errors;
      if (graphqlErrors) {
        console.error("[packpost] order lookup GraphQL errors", graphqlErrors);
      }

      const wantedName = normalizeOrderName(orderName);
      const order = json.data?.orders?.edges?.[0]?.node as
        | { id: string; name: string; email?: string | null }
        | undefined;

      // Belt-and-suspenders: confirm the name matches exactly (the search
      // index can be fuzzy) before trusting the match.
      if (order && order.name === wantedName) {
        const created = await ensureOrderTimeline({
          shopDomain: session.shop,
          shopifyOrderId: order.id.split("/").pop()!,
          orderName: order.name,
          customerEmail: order.email ?? email,
        });
        if (created) {
          result = await findPublicTimeline({
            shopDomain: session.shop,
            orderName,
            email,
          });
        }
      }
    } catch (error) {
      console.error("[packpost] live order lookup failed", error);
    }
  }

  if (!result) {
    await logLookupMiss(session.shop, orderName, email);
    // 200 rather than 404: a wrong order/email is an expected outcome, not a
    // server error, and the widget shouldn't surface a failed network request.
    return Response.json({ error: "not_found" });
  }

  return Response.json(result);
};
