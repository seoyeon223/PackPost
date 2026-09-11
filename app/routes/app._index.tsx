import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, PRO_PLAN } from "../shopify.server";
import db from "../db.server";
import {
  countMonthlyTimelines,
  ensureOrderTimeline,
  FREE_MONTHLY_ORDER_LIMIT,
  getOrCreateShop,
  getStages,
  setStage,
} from "../models/timeline.server";
import { getDashboardMessages, resolveLocale } from "../i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const locale = resolveLocale(request.headers.get("accept-language"));

  const shop = await getOrCreateShop(session.shop, locale);

  // Keep our own plan flag in sync with Shopify's billing state — this is
  // what gates the free monthly cap and the storefront widget's badge.
  const { hasActivePayment } = await billing.check({ plans: [PRO_PLAN] });
  const plan = hasActivePayment ? "pro" : "free";
  if (shop.plan !== plan) {
    await db.shop.update({
      where: { shopDomain: session.shop },
      data: { plan, hideBranding: hasActivePayment },
    });
  }

  const timelines = await db.orderTimeline.findMany({
    where: { shopDomain: session.shop },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  const monthlyCount = await countMonthlyTimelines(session.shop);

  return {
    stages: getStages(shop),
    timelines,
    plan,
    monthlyCount,
    limit: FREE_MONTHLY_ORDER_LIMIT,
    // Locale only — getDashboardMessages() has function values (e.g. bulkApply),
    // and loader data is JSON-serialized, so functions can't survive the trip.
    locale,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "updateStage") {
    const stageKey = String(formData.get("stageKey"));
    const ids = String(formData.get("ids"))
      .split(",")
      .filter(Boolean);
    const note = formData.get("note");

    for (const id of ids) {
      await setStage({
        orderTimelineId: id,
        stageKey,
        note: note ? String(note) : undefined,
      });
    }
    return { ok: true, updated: ids.length };
  }

  if (intent === "deleteTimelines") {
    const ids = String(formData.get("ids"))
      .split(",")
      .filter(Boolean);

    const { count } = await db.orderTimeline.deleteMany({
      where: { id: { in: ids }, shopDomain: session.shop },
    });
    return { ok: true, deleted: count };
  }

  if (intent === "syncOrders") {
    const response = await admin.graphql(
      `#graphql
        query recentOrders {
          orders(first: 50, sortKey: CREATED_AT, reverse: true) {
            edges {
              node {
                id
                name
                email
                customer {
                  defaultEmailAddress {
                    emailAddress
                  }
                }
              }
            }
          }
        }`,
    );
    const json = await response.json();
    const edges = json.data?.orders?.edges ?? [];

    let skipped = 0;
    for (const { node } of edges) {
      const shopifyOrderId = node.id.split("/").pop();
      const result = await ensureOrderTimeline({
        shopDomain: session.shop,
        shopifyOrderId,
        orderName: node.name,
        // order.email can be blank before contact info is fully attached
        // (e.g. unpaid orders) — fall back to the linked customer's email.
        customerEmail:
          node.email || node.customer?.defaultEmailAddress?.emailAddress || null,
      });
      if (!result) skipped += 1;
    }
    return { ok: true, synced: edges.length - skipped, skipped };
  }

  return { ok: false };
};

export default function Index() {
  const { stages, timelines, plan, monthlyCount, limit, locale } =
    useLoaderData<typeof loader>();
  const t = getDashboardMessages(locale);
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkStage, setBulkStage] = useState(stages[0]?.key ?? "");

  const isBusy = fetcher.state !== "idle";

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const applyBulk = () => {
    if (selected.length === 0 || !bulkStage) return;
    fetcher.submit(
      { _action: "updateStage", stageKey: bulkStage, ids: selected.join(",") },
      { method: "POST" },
    );
    shopify.toast.show(t.toastBulkUpdated(selected.length));
    setSelected([]);
  };

  const applySingle = (id: string, stageKey: string) => {
    fetcher.submit(
      { _action: "updateStage", stageKey, ids: id },
      { method: "POST" },
    );
  };

  const deleteSingle = (id: string) => {
    if (!window.confirm(t.confirmDelete)) return;
    fetcher.submit({ _action: "deleteTimelines", ids: id }, { method: "POST" });
    shopify.toast.show(t.toastDeleted(1));
    setSelected((prev) => prev.filter((x) => x !== id));
  };

  const deleteBulk = () => {
    if (selected.length === 0) return;
    if (!window.confirm(t.confirmBulkDelete(selected.length))) return;
    fetcher.submit(
      { _action: "deleteTimelines", ids: selected.join(",") },
      { method: "POST" },
    );
    shopify.toast.show(t.toastDeleted(selected.length));
    setSelected([]);
  };

  const syncOrders = () => {
    fetcher.submit({ _action: "syncOrders" }, { method: "POST" });
    shopify.toast.show(t.toastSyncing);
  };

  useEffect(() => {
    const skipped =
      fetcher.data && "skipped" in fetcher.data ? fetcher.data.skipped ?? 0 : 0;
    if (skipped > 0) {
      shopify.toast.show(t.toastSyncSkipped(skipped), { isError: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  return (
    <s-page heading={t.heading}>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={syncOrders}
        {...(isBusy ? { loading: true } : {})}
      >
        {t.syncOrders}
      </s-button>

      <s-section heading={t.introHeading}>
        <s-paragraph>
          {t.introBefore}
          <s-text type="strong">{t.introStrong}</s-text>
          {t.introAfter}
        </s-paragraph>
      </s-section>

      <s-section heading={t.usageHeading}>
        <s-paragraph>
          {plan === "pro" ? t.usageProBody : t.usageBody(monthlyCount, limit)}
        </s-paragraph>
        {plan === "free" && monthlyCount >= limit && (
          <s-paragraph color="subdued">{t.usageOverLimit}</s-paragraph>
        )}
        {plan === "free" && (
          <s-link href="/app/billing">{t.upgradeLink}</s-link>
        )}
      </s-section>

      <s-section heading={t.bulkHeading}>
        <s-stack direction="inline" gap="base">
          <s-select
            label={t.bulkSelectLabel}
            value={bulkStage}
            onChange={(e: Event) =>
              setBulkStage((e.currentTarget as HTMLSelectElement).value)
            }
          >
            {stages.map((s) => (
              <s-option key={s.key} value={s.key}>
                {s.label}
              </s-option>
            ))}
          </s-select>
          <s-button
            onClick={applyBulk}
            disabled={selected.length === 0}
            {...(isBusy ? { loading: true } : {})}
          >
            {t.bulkApply(selected.length)}
          </s-button>
          <s-button
            variant="tertiary"
            tone="critical"
            onClick={deleteBulk}
            disabled={selected.length === 0}
            {...(isBusy ? { loading: true } : {})}
          >
            {t.bulkDelete(selected.length)}
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading={t.ordersHeading(timelines.length)}>
        {timelines.length === 0 ? (
          <s-paragraph>{t.ordersEmpty}</s-paragraph>
        ) : (
          <s-stack direction="block" gap="small">
            {timelines.map((timeline) => (
              <s-box
                key={timeline.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="inline" gap="base" alignItems="center">
                  <input
                    type="checkbox"
                    checked={selected.includes(timeline.id)}
                    onChange={() => toggle(timeline.id)}
                  />
                  <s-text type="strong">{timeline.orderName}</s-text>
                  <s-text color="subdued">{timeline.customerEmail ?? t.noEmail}</s-text>
                  <s-select
                    label={t.stageLabel}
                    labelAccessibilityVisibility="exclusive"
                    value={timeline.currentStage}
                    onChange={(e: Event) =>
                      applySingle(timeline.id, (e.currentTarget as HTMLSelectElement).value)
                    }
                  >
                    {stages.map((s) => (
                      <s-option key={s.key} value={s.key}>
                        {s.label}
                      </s-option>
                    ))}
                  </s-select>
                  <s-text color="subdued">
                    {t.lastUpdated(new Date(timeline.updatedAt).toLocaleString(t.dateLocale))}
                  </s-text>
                  <s-button
                    variant="tertiary"
                    tone="critical"
                    onClick={() => deleteSingle(timeline.id)}
                  >
                    {t.deleteButton}
                  </s-button>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section slot="aside" heading={t.customizeHeading}>
        <s-paragraph>{t.customizeBody}</s-paragraph>
        <s-link href="/app/settings">{t.customizeLink}</s-link>
      </s-section>

      <s-section slot="aside" heading={t.buyerNoticeHeading}>
        <s-paragraph color="subdued">{t.buyerNoticeBody}</s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
