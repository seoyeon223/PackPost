import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory privacy webhook: erase the customer email we stored for their orders.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const orderIds = (
    (payload as { orders_to_redact?: Array<number | string> })
      .orders_to_redact ?? []
  ).map(String);

  if (orderIds.length > 0) {
    await db.orderTimeline.updateMany({
      where: { shopDomain: shop, shopifyOrderId: { in: orderIds } },
      data: { customerEmail: null },
    });
  }

  return new Response();
};
