import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { findPublicTimeline } from "../models/timeline.server";

// Reached via Shopify App Proxy at https://<shop-domain>/apps/packpost/status
// (same-origin from the storefront's point of view, so no CORS/API key needed).
// authenticate.public.appProxy verifies Shopify's HMAC signature on the request.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const orderName = url.searchParams.get("order");
  const email = url.searchParams.get("email");

  if (!orderName || !email) {
    return Response.json({ error: "missing_params" }, { status: 400 });
  }

  const result = await findPublicTimeline({
    shopDomain: session.shop,
    orderName,
    email,
  });

  if (!result) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json(result);
};
