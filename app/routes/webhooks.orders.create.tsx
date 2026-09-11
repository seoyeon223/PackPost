import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureOrderTimeline } from "../models/timeline.server";

// Fires when a new order comes in, so every order gets a timeline row
// (starting at the shop's first stage) without the seller having to do
// anything manually first.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const order = payload as {
    id: number | string;
    name: string;
    email?: string | null;
    contact_email?: string | null;
  };

  await ensureOrderTimeline({
    shopDomain: shop,
    shopifyOrderId: String(order.id),
    orderName: order.name,
    // `??` wouldn't fall through here — Shopify can send "" rather than
    // omitting the field, and "" is not null/undefined.
    customerEmail: order.email || order.contact_email || null,
  });

  return new Response();
};
