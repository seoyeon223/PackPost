export type Locale = "ko" | "en";

// Reads the embedded admin's Accept-Language header (reflects the merchant's
// chosen Shopify Admin interface language) since offline-token sessions don't
// carry a `locale` field. Also accepts a bare locale string (e.g. from our own
// stored Session rows) for the same purpose.
export function resolveLocale(acceptLanguageOrLocale?: string | null): Locale {
  if (!acceptLanguageOrLocale) return "ko";
  const primary = acceptLanguageOrLocale.split(",")[0]?.trim().toLowerCase() ?? "";
  return primary.startsWith("en") ? "en" : "ko";
}

const dashboard = {
  ko: {
    heading: "PackPost",
    syncOrders: "최근 주문 불러오기",
    introHeading: "투명한 배송 현황 공유",
    introBefore: "이 앱은 실시간 배송 추적이 아니라, ",
    introStrong: "셀러가 직접 입력하는",
    introAfter:
      " 배송 현황 공유 도구입니다. 아래에서 주문을 선택해 단계를 갱신하면 구매자 주문 페이지의 타임라인에 즉시 반영됩니다.",
    bulkHeading: "일괄 상태 변경",
    bulkSelectLabel: "변경할 단계",
    bulkApply: (count: number) => `선택한 ${count}건 변경`,
    ordersHeading: (count: number) => `주문 목록 (${count})`,
    ordersEmpty:
      "아직 주문 타임라인이 없습니다. 새 주문이 들어오면 자동으로 추가되고, 기존 주문은 “최근 주문 불러오기”로 가져올 수 있습니다.",
    noEmail: "이메일 없음",
    stageLabel: "단계",
    lastUpdated: (date: string) => `최근 갱신: ${date}`,
    customizeHeading: "단계 커스터마이징",
    customizeBody: "상품군에 맞게 단계를 추가/삭제/이름 변경할 수 있습니다.",
    customizeLink: "단계 설정으로 이동",
    buyerNoticeHeading: "구매자에게 보이는 문구",
    buyerNoticeBody:
      "“이 정보는 판매자가 직접 입력한 참고용 안내이며, 실시간 위치 추적 정보가 아닙니다.” — 위젯에 항상 함께 표시됩니다.",
    toastBulkUpdated: (count: number) => `${count}건 상태를 변경했습니다`,
    toastSyncing: "최근 주문을 불러오는 중...",
    deleteButton: "삭제",
    bulkDelete: (count: number) => `선택한 ${count}건 삭제`,
    confirmDelete:
      "이 주문의 타임라인 기록을 삭제할까요? Shopify의 실제 주문은 삭제되지 않으며, 구매자 조회 위젯에서도 더 이상 나타나지 않습니다.",
    confirmBulkDelete: (count: number) =>
      `선택한 ${count}건의 타임라인 기록을 삭제할까요? Shopify의 실제 주문은 삭제되지 않습니다.`,
    toastDeleted: (count: number) => `${count}건 삭제했습니다`,
    usageHeading: "이번 달 사용량",
    usageBody: (count: number, limit: number) => `무료 플랜: 이번 달 ${count}/${limit}건 사용 중`,
    usageOverLimit:
      "이번 달 무료 한도를 넘었습니다. 한도를 넘긴 신규 주문은 추적되지 않으니, Pro로 업그레이드하면 무제한으로 쓸 수 있습니다.",
    usageProBody: "Pro 플랜: 주문 수 제한 없음",
    upgradeLink: "요금제 보기",
    toastSyncSkipped: (skipped: number) =>
      `무료 한도 초과로 ${skipped}건은 추적하지 못했습니다. Pro로 업그레이드해주세요.`,
    dateLocale: "ko-KR",
  },
  en: {
    heading: "PackPost",
    syncOrders: "Sync recent orders",
    introHeading: "Transparent delivery updates",
    introBefore: "This isn't real-time tracking — it's a ",
    introStrong: "seller-updated",
    introAfter:
      " delivery status tool. Pick an order below and update its stage; buyers see it on their order lookup timeline right away.",
    bulkHeading: "Bulk update",
    bulkSelectLabel: "Stage to apply",
    bulkApply: (count: number) => `Update ${count} selected`,
    ordersHeading: (count: number) => `Orders (${count})`,
    ordersEmpty:
      'No order timelines yet. New orders are added automatically, and existing orders can be pulled in with "Sync recent orders".',
    noEmail: "No email",
    stageLabel: "Stage",
    lastUpdated: (date: string) => `Last updated: ${date}`,
    customizeHeading: "Customize stages",
    customizeBody: "Add, remove, or rename stages to match your product line.",
    customizeLink: "Go to stage settings",
    buyerNoticeHeading: "What buyers see",
    buyerNoticeBody:
      '"This information was entered manually by the seller and is not real-time location tracking." — always shown alongside the widget.',
    toastBulkUpdated: (count: number) => `Updated ${count} orders`,
    toastSyncing: "Syncing recent orders...",
    deleteButton: "Delete",
    bulkDelete: (count: number) => `Delete ${count} selected`,
    confirmDelete:
      "Delete this order's timeline record? The actual Shopify order won't be affected, but it will no longer show up in the buyer's lookup widget.",
    confirmBulkDelete: (count: number) =>
      `Delete the timeline record for ${count} selected orders? The actual Shopify orders won't be affected.`,
    toastDeleted: (count: number) => `Deleted ${count} orders`,
    usageHeading: "This month's usage",
    usageBody: (count: number, limit: number) => `Free plan: ${count}/${limit} orders used this month`,
    usageOverLimit:
      "You're over the free monthly limit. New orders beyond the limit aren't tracked — upgrade to Pro for unlimited orders.",
    usageProBody: "Pro plan: no order limit",
    upgradeLink: "View plans",
    toastSyncSkipped: (skipped: number) =>
      `${skipped} order(s) weren't tracked because you're over the free limit. Please upgrade to Pro.`,
    dateLocale: "en-US",
  },
} as const;

const settings = {
  ko: {
    heading: "배송 단계 설정",
    save: "저장",
    editHeading: "타임라인 단계 편집",
    editBody:
      "상품군에 맞게 단계를 추가/삭제/순서 변경하세요. 예를 들어 국내 배송만 하는 셀러는 “통관중” 단계를 삭제할 수 있습니다.",
    stageFieldLabel: (i: number) => `단계 ${i}`,
    moveUp: "위로",
    moveDown: "아래로",
    delete: "삭제",
    addStage: "+ 단계 추가",
    legalHeading: "법적 안내",
    legalBody:
      "이 단계 정보는 셀러가 직접 입력하는 참고용 안내입니다. 실제 운송장번호/택배사 조회는 Shopify 주문 상태 페이지에 별도로 항상 함께 표시되며, 이 설정으로 대체되지 않습니다.",
    toastSaved: "저장되었습니다",
  },
  en: {
    heading: "Delivery stage settings",
    save: "Save",
    editHeading: "Edit timeline stages",
    editBody:
      'Add, remove, or reorder stages to match your product line. For example, a domestic-only seller can delete the "Customs" stage.',
    stageFieldLabel: (i: number) => `Stage ${i}`,
    moveUp: "Move up",
    moveDown: "Move down",
    delete: "Delete",
    addStage: "+ Add stage",
    legalHeading: "Legal note",
    legalBody:
      "This stage information is entered manually by the seller. The actual tracking number/carrier lookup is always shown separately on the Shopify order status page and is not replaced by this setting.",
    toastSaved: "Saved",
  },
} as const;

const nav = {
  ko: { orders: "주문 타임라인", settings: "단계 설정", billing: "요금제" },
  en: { orders: "Order timeline", settings: "Stage settings", billing: "Billing" },
} as const;

const billing = {
  ko: {
    heading: "요금제",
    currentPlanHeading: "현재 플랜",
    currentFree: "Free 플랜 — 월 50건까지 무료",
    currentPro: "Pro 플랜 — 주문 수 제한 없음",
    managedPricingNote:
      "플랜 변경은 Shopify 앱 관리 화면에서 할 수 있습니다 — 이 페이지는 현재 플랜 확인용입니다.",
    plansHeading: "플랜 비교",
    freePlanTitle: "Free — $0/월",
    freePlanBody: "월 50건까지 주문 추적, 커스텀 단계, 스토어프론트 위젯. 위젯에 \"Powered by PackPost\" 배지가 표시됩니다.",
    proPlanTitle: "Pro — $6.99/월",
    proPlanBody: "주문 수 제한 없음, 위젯 배지 제거.",
  },
  en: {
    heading: "Billing",
    currentPlanHeading: "Current plan",
    currentFree: "Free plan — up to 50 orders/month",
    currentPro: "Pro plan — no order limit",
    managedPricingNote:
      "Change your plan from Shopify's app management screen — this page just shows your current plan.",
    plansHeading: "Compare plans",
    freePlanTitle: "Free — $0/month",
    freePlanBody: 'Track up to 50 orders/month, custom stages, storefront widget. The widget shows a "Powered by PackPost" badge.',
    proPlanTitle: "Pro — $6.99/month",
    proPlanBody: "No order limit, badge removed.",
  },
} as const;

export function getDashboardMessages(locale: Locale) {
  return dashboard[locale];
}

export function getSettingsMessages(locale: Locale) {
  return settings[locale];
}

export function getNavMessages(locale: Locale) {
  return nav[locale];
}

export function getBillingMessages(locale: Locale) {
  return billing[locale];
}
