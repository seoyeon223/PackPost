import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, PRO_PLAN } from "../shopify.server";
import db from "../db.server";
import { getBillingMessages, resolveLocale } from "../i18n";

// This app is listed with Shopify-managed pricing plans (required for the
// App Store listing), so Shopify — not this app — owns plan selection and
// charge creation; calling billing.request()/billing.cancel() ourselves is
// rejected once public plans exist. This page only reads the current plan
// (billing.check() still works for that) to drive the free-tier order cap
// and the storefront widget's badge; merchants change plans through
// Shopify's own plan management screen.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const locale = resolveLocale(request.headers.get("accept-language"));

  const { hasActivePayment } = await billing.check({ plans: [PRO_PLAN] });
  const plan = hasActivePayment ? "pro" : "free";

  await db.shop.update({
    where: { shopDomain: session.shop },
    data: { plan, hideBranding: hasActivePayment },
  });

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
