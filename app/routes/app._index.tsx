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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const shop = await getOrCreateShop(session.shop);
  const timelines = await db.orderTimeline.findMany({
    where: { shopDomain: session.shop },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return { stages: getStages(shop), timelines };
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
  const { stages, timelines } = useLoaderData<typeof loader>();
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
    shopify.toast.show(`${selected.length}건 상태를 변경했습니다`);
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
    shopify.toast.show("최근 주문을 불러오는 중...");
  };

  return (
    <s-page heading="PackPost">
      <s-button slot="primary-action" onClick={syncOrders} {...(isBusy ? { loading: true } : {})}>
        최근 주문 불러오기
      </s-button>

      <s-section heading="투명한 배송 현황 공유">
        <s-paragraph>
          이 앱은 실시간 배송 추적이 아니라, <s-text type="strong">셀러가 직접 입력하는</s-text> 배송
          현황 공유 도구입니다. 아래에서 주문을 선택해 단계를 갱신하면 구매자
          주문 페이지의 타임라인에 즉시 반영됩니다.
        </s-paragraph>
      </s-section>

      <s-section heading="일괄 상태 변경">
        <s-stack direction="inline" gap="base">
          <s-select
            label="변경할 단계"
            value={bulkStage}
            onChange={(e: Event) =>
              setBulkStage((e.currentTarget as HTMLSelectElement).value)
            }
          >
            {stages.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </s-select>
          <s-button
            onClick={applyBulk}
            disabled={selected.length === 0}
            {...(isBusy ? { loading: true } : {})}
          >
            선택한 {selected.length}건 변경
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading={`주문 목록 (${timelines.length})`}>
        {timelines.length === 0 ? (
          <s-paragraph>
            아직 주문 타임라인이 없습니다. 새 주문이 들어오면 자동으로
            추가되고, 기존 주문은 &ldquo;최근 주문 불러오기&rdquo;로 가져올 수 있습니다.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="small">
            {timelines.map((t) => (
              <s-box
                key={t.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack direction="inline" gap="base" alignItems="center">
                  <input
                    type="checkbox"
                    checked={selected.includes(t.id)}
                    onChange={() => toggle(t.id)}
                  />
                  <s-text type="strong">{t.orderName}</s-text>
                  <s-text color="subdued">{t.customerEmail ?? "이메일 없음"}</s-text>
                  <s-select
                    label="단계"
                    labelAccessibilityVisibility="exclusive"
                    value={t.currentStage}
                    onChange={(e: Event) =>
                      applySingle(t.id, (e.currentTarget as HTMLSelectElement).value)
                    }
                  >
                    {stages.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </s-select>
                  <s-text color="subdued">
                    최근 갱신: {new Date(t.updatedAt).toLocaleString("ko-KR")}
                  </s-text>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section slot="aside" heading="단계 커스터마이징">
        <s-paragraph>
          상품군에 맞게 단계를 추가/삭제/이름 변경할 수 있습니다.
        </s-paragraph>
        <s-link href="/app/settings">단계 설정으로 이동</s-link>
      </s-section>

      <s-section slot="aside" heading="구매자에게 보이는 문구">
        <s-paragraph color="subdued">
          &ldquo;이 정보는 판매자가 직접 입력한 참고용 안내이며, 실시간 위치 추적
          정보가 아닙니다.&rdquo; — 위젯에 항상 함께 표시됩니다.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
