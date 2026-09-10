import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Mandatory privacy webhook. This app only stores order id/name, a shop-provided
// customer email, and seller-entered stage notes — no other customer PII.
// Fulfilling a data request is a manual export today (small user base); this
// handler just acknowledges receipt so Shopify's compliance check passes.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`, payload);
  return new Response();
};
