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
    customer?: { email?: string | null } | null;
  };

  // Temporary diagnostic for the App Store review's "order information not
  // found" rejection — confirms whether the email fields are genuinely empty
  // in the webhook payload (e.g. Protected Customer Data not yet approved)
  // versus some other bug. Presence-only (no PII in logs). Remove once the
  // storefront widget is confirmed working end-to-end.
  console.log("[packpost] orders/create email field presence", {
    shop,
    orderName: order.name,
    hasEmail: Boolean(order.email),
    hasContactEmail: Boolean(order.contact_email),
    hasCustomerEmail: Boolean(order.customer?.email),
  });

  await ensureOrderTimeline({
    shopDomain: shop,
    shopifyOrderId: String(order.id),
    orderName: order.name,
    // `??` wouldn't fall through here — Shopify can send "" rather than
    // omitting the field, and "" is not null/undefined. The order's own
    // email/contact_email can also be blank when the email only lives on
    // the linked customer profile, so fall back to that too.
    customerEmail: order.email || order.contact_email || order.customer?.email || null,
  });

  return new Response();
};
