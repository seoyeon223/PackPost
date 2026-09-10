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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  return { stages: getStages(shop) };
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
  const { stages: initialStages } = useLoaderData<typeof loader>();
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
    shopify.toast.show("저장되었습니다");
  };

  return (
    <s-page heading="배송 단계 설정">
      <s-button slot="primary-action" onClick={save}>
        저장
      </s-button>

      <s-section heading="타임라인 단계 편집">
        <s-paragraph color="subdued">
          상품군에 맞게 단계를 추가/삭제/순서 변경하세요. 예를 들어 국내
          배송만 하는 셀러는 &ldquo;통관중&rdquo; 단계를 삭제할 수 있습니다.
        </s-paragraph>
        <s-stack direction="block" gap="small">
          {stages.map((s, i) => (
            <s-stack
              key={s.key}
              direction="inline"
              gap="small"
              alignItems="center"
            >
              <s-text-field
                label={`단계 ${i + 1}`}
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
                위로
              </s-button>
              <s-button
                variant="tertiary"
                onClick={() => move(i, 1)}
                disabled={i === stages.length - 1}
              >
                아래로
              </s-button>
              <s-button
                variant="tertiary"
                tone="critical"
                onClick={() => removeStage(i)}
                disabled={stages.length <= 1}
              >
                삭제
              </s-button>
            </s-stack>
          ))}
        </s-stack>
        <s-button variant="secondary" onClick={addStage}>
          + 단계 추가
        </s-button>
      </s-section>

      <s-section slot="aside" heading="법적 안내">
        <s-paragraph color="subdued">
          이 단계 정보는 셀러가 직접 입력하는 참고용 안내입니다. 실제
          운송장번호/택배사 조회는 Shopify 주문 상태 페이지에 별도로 항상
          함께 표시되며, 이 설정으로 대체되지 않습니다.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
