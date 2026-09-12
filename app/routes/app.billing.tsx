import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, BILLING_TEST_MODE, PRO_PLAN } from "../shopify.server";
import db from "../db.server";
import { getBillingMessages, resolveLocale } from "../i18n";

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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "cancel") {
    const { appSubscriptions } = await billing.check({ plans: [PRO_PLAN] });
    const subscription = appSubscriptions[0];
    if (subscription) {
      await billing.cancel({
        subscriptionId: subscription.id,
        isTest: BILLING_TEST_MODE,
        prorate: true,
      });
    }
    await db.shop.update({
      where: { shopDomain: session.shop },
      data: { plan: "free", hideBranding: false },
    });
    return { ok: true };
  }

  return { ok: false };
};

export default function Billing() {
  const { plan, locale } = useLoaderData<typeof loader>();
  const t = getBillingMessages(locale);
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const cancel = () => {
    if (!window.confirm(t.confirmCancel)) return;
    fetcher.submit({ _action: "cancel" }, { method: "POST" });
    shopify.toast.show(t.toastCancelled);
  };

  const upgrade = () => {
    // Both a POST (fetcher/Form) and a plain href link end up going through
    // the embedded app's own client-side navigation, which fetches this as
    // `.data` and then tries to follow billing.request()'s cross-origin
    // redirect via fetch — which fails (401) because it's not a real
    // top-level browser navigation. Setting window.top.location directly
    // bypasses all of that click/navigation interception.
    window.top!.location.href = `${window.location.origin}/app/billing/upgrade`;
  };

  return (
    <s-page heading={t.heading}>
      <s-section heading={t.currentPlanHeading}>
        <s-paragraph>{plan === "pro" ? t.currentPro : t.currentFree}</s-paragraph>
        {plan === "pro" ? (
          <s-button variant="tertiary" tone="critical" onClick={cancel}>
            {t.cancelButton}
          </s-button>
        ) : (
          <s-button onClick={upgrade}>{t.upgradeButton}</s-button>
        )}
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
