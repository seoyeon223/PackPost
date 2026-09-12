import type { LoaderFunctionArgs } from "react-router";
import { authenticate, BILLING_TEST_MODE, PRO_PLAN } from "../shopify.server";

// Reached via a plain link click (GET), not a form POST. billing.request()
// throws a redirect to Shopify's charge-confirmation page, and — because
// this is a normal client-side navigation rather than a fetch/form POST —
// React Router falls back to a real browser navigation for the external
// redirect target instead of trying to follow it as a fetch, which is what
// was breaking the session-token/cookie handling in earlier attempts.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);

  return billing.request({
    plan: PRO_PLAN,
    isTest: BILLING_TEST_MODE,
    returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing`,
  });
};
