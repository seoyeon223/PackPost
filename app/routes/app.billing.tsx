import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { syncShopPlan } from "../models/billing.server";
import { getBillingMessages, resolveLocale } from "../i18n";

// This app is listed with Shopify App Pricing (formerly "Managed Pricing",
// required for the App Store listing), so Shopify — not this app — owns
// plan selection and charge creation; calling
// billing.request()/billing.cancel() ourselves is rejected once public
// plans exist. This page only reads the current plan (see
// models/billing.server.ts for why that's a Partner API call, not
// billing.check()) to drive the free-tier order cap and the storefront
// widget's badge; merchants change plans through Shopify's own plan
// management screen.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const locale = resolveLocale(request.headers.get("accept-language"));

  const plan = await syncShopPlan({ shopDomain: session.shop, admin, billing });

  return { locale, plan };
};

export default function Billing() {
  const { plan, locale } = useLoaderData<typeof loader>();
  const t = getBillingMessages(locale);

  return (
    <s-page heading={t.heading}>
      <s-section heading={t.currentPlanHeading}>
        <s-paragraph>{plan === "pro" ? t.currentPro : t.currentFree}</s-paragraph>
        <s-paragraph color="subdued">{t.managedPricingNote}</s-paragraph>
      </s-section>

      <s-section heading={t.plansHeading}>
        <s-stack direction="block" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text type="strong">{t.freePlanTitle}</s-text>
            <s-paragraph color="subdued">{t.freePlanBody}</s-paragraph>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-text type="strong">{t.proPlanTitle}</s-text>
            <s-paragraph color="subdued">{t.proPlanBody}</s-paragraph>
          </s-box>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
