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
import { getOrCreateShop, getStages, type Stage } from "../models/timeline.server";
import { getSettingsMessages, resolveLocale } from "../i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const locale = resolveLocale(request.headers.get("accept-language"));
  const shop = await getOrCreateShop(session.shop, locale);
  // Locale only — getSettingsMessages() has function values (e.g. stageFieldLabel),
  // and loader data is JSON-serialized, so functions can't survive the trip.
  return { stages: getStages(shop), locale };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  let stages: Stage[];
  try {
    stages = JSON.parse(String(formData.get("stages") ?? "[]"));
  } catch {
    return { ok: false, error: "invalid_json" };
  }

  const cleaned = stages
    .map((s) => ({ key: s.key, label: (s.label ?? "").trim() }))
    .filter((s) => s.label.length > 0);

  if (cleaned.length === 0) {
    return { ok: false, error: "empty" };
  }

  await db.shop.update({
    where: { shopDomain: session.shop },
    data: { stages: cleaned },
  });

  return { ok: true };
};

export default function Settings() {
  const { stages: initialStages, locale } = useLoaderData<typeof loader>();
  const t = getSettingsMessages(locale);
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [stages, setStages] = useState<Stage[]>(initialStages);

  const updateLabel = (index: number, label: string) =>
    setStages((prev) =>
      prev.map((s, i) => (i === index ? { ...s, label } : s)),
    );

  const addStage = () =>
    setStages((prev) => [
      ...prev,
      { key: `stage_${Date.now()}`, label: "" },
    ]);

  const removeStage = (index: number) =>
    setStages((prev) => prev.filter((_, i) => i !== index));

  const move = (index: number, dir: -1 | 1) =>
    setStages((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const save = () => {
    fetcher.submit(
      { stages: JSON.stringify(stages) },
      { method: "POST" },
    );
    shopify.toast.show(t.toastSaved);
  };

  return (
    <s-page heading={t.heading}>
      <s-button slot="primary-action" onClick={save}>
        {t.save}
      </s-button>

      <s-section heading={t.editHeading}>
        <s-paragraph color="subdued">{t.editBody}</s-paragraph>
        <s-stack direction="block" gap="small">
          {stages.map((s, i) => (
            <s-stack
              key={s.key}
              direction="inline"
              gap="small"
              alignItems="center"
            >
              <s-text-field
                label={t.stageFieldLabel(i + 1)}
                labelAccessibilityVisibility="exclusive"
                value={s.label}
                onChange={(e: Event) =>
                  updateLabel(i, (e.currentTarget as HTMLInputElement).value)
                }
              />
              <s-button
                variant="tertiary"
                onClick={() => move(i, -1)}
                disabled={i === 0}
              >
                {t.moveUp}
              </s-button>
              <s-button
                variant="tertiary"
                onClick={() => move(i, 1)}
                disabled={i === stages.length - 1}
              >
                {t.moveDown}
              </s-button>
              <s-button
                variant="tertiary"
                tone="critical"
                onClick={() => removeStage(i)}
                disabled={stages.length <= 1}
              >
                {t.delete}
              </s-button>
            </s-stack>
          ))}
        </s-stack>
        <s-button variant="secondary" onClick={addStage}>
          {t.addStage}
        </s-button>
      </s-section>

      <s-section slot="aside" heading={t.legalHeading}>
        <s-paragraph color="subdued">{t.legalBody}</s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
