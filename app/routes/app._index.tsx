import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  ensureOrderTimeline,
  getOrCreateShop,
  getStages,
  setStage,
} from "../models/timeline.server";
import { getDashboardMessages, resolveLocale } from "../i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const locale = resolveLocale(request.headers.get("accept-language"));

  const shop = await getOrCreateShop(session.shop, locale);
  const timelines = await db.orderTimeline.findMany({
    where: { shopDomain: session.shop },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return {
    stages: getStages(shop),
    timelines,
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
              }
            }
          }
        }`,
    );
    const json = await response.json();
    const edges = json.data?.orders?.edges ?? [];

    for (const { node } of edges) {
      const shopifyOrderId = node.id.split("/").pop();
      await ensureOrderTimeline({
        shopDomain: session.shop,
        shopifyOrderId,
        orderName: node.name,
        customerEmail: node.email,
      });
    }
    return { ok: true, synced: edges.length };
  }

  return { ok: false };
};

export default function Index() {
  const { stages, timelines, locale } = useLoaderData<typeof loader>();
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

  const syncOrders = () => {
    fetcher.submit({ _action: "syncOrders" }, { method: "POST" });
    shopify.toast.show(t.toastSyncing);
  };

  return (
    <s-page heading={t.heading}>
      <s-button slot="primary-action" onClick={syncOrders} {...(isBusy ? { loading: true } : {})}>
        {t.syncOrders}
      </s-button>

      <s-section heading={t.introHeading}>
        <s-paragraph>
          {t.introBefore}
          <s-text type="strong">{t.introStrong}</s-text>
          {t.introAfter}
        </s-paragraph>
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
