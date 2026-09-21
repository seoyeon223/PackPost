import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  ensureOrderTimeline,
  findPublicTimeline,
  logLookupMiss,
  normalizeOrderName,
} from "../models/timeline.server";

type OrderNode = { id: string; name: string; email?: string | null };

async function backfillFromOrder(
  order: OrderNode,
  params: { shopDomain: string; orderName: string; email: string },
) {
  const created = await ensureOrderTimeline({
    shopDomain: params.shopDomain,
    shopifyOrderId: order.id.split("/").pop()!,
    orderName: order.name,
    customerEmail: order.email ?? params.email,
  });
  if (!created) return null;
  return findPublicTimeline({
    shopDomain: params.shopDomain,
    orderName: params.orderName,
    email: params.email,
  });
}

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
      const order = json.data?.orders?.edges?.[0]?.node as OrderNode | undefined;

      // Belt-and-suspenders: confirm the name matches exactly (the search
      // index can be fuzzy) before trusting the match.
      if (order && order.name === wantedName) {
        result = await backfillFromOrder(order, { shopDomain: session.shop, orderName, email });
      }
    } catch (error) {
      console.error("[packpost] live order lookup (search) failed", error);
    }
  }

  // The `query:`-filtered search above goes through Shopify's search index,
  // which can lag a few seconds/minutes behind order creation — exactly the
  // "works after clicking 최근 주문 불러오기 but not before" symptom, since
  // that button's unfiltered recent-orders list doesn't depend on the index.
  // Mirror that button's approach here as a last resort: scan the most
  // recent orders directly instead of searching.
  if (!result) {
    try {
      const wantedName = normalizeOrderName(orderName);
      const wantedEmail = email.trim().toLowerCase();
      const response = await admin.graphql(
        `#graphql
          query RecentOrdersForLookup {
            orders(first: 50, sortKey: CREATED_AT, reverse: true) {
              edges {
                node {
                  id
                  name
                  email
                }
              }
            }
          }`,
      );
      const json = await response.json();
      const graphqlErrors = (json as { errors?: unknown }).errors;
      if (graphqlErrors) {
        console.error("[packpost] order lookup GraphQL errors (recent scan)", graphqlErrors);
      }

      const nodes = (json.data?.orders?.edges ?? []).map(
        (e: { node: OrderNode }) => e.node,
      ) as OrderNode[];
      const order = nodes.find(
        (n) =>
          n.name === wantedName &&
          n.email &&
          n.email.trim().toLowerCase() === wantedEmail,
      );

      if (order) {
        result = await backfillFromOrder(order, { shopDomain: session.shop, orderName, email });
      }
    } catch (error) {
      console.error("[packpost] live order lookup (recent scan) failed", error);
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
