import prisma from "../db.server";
import { resolveLocale, type Locale } from "../i18n";

export type Stage = { key: string; label: string };

// Default steps cover the common K-pop goods flow: local pack-out, international
// leg, customs, then domestic last-mile. Sellers can rename/reorder/trim these
// per-shop from the Settings page (e.g. domestic-only sellers drop customs).
export const DEFAULT_STAGES_KO: Stage[] = [
  { key: "payment_confirmed", label: "결제 확인" },
  { key: "preparing", label: "상품 준비중" },
  { key: "packed", label: "포장 완료" },
  { key: "shipped_overseas", label: "현지 발송" },
  { key: "in_transit", label: "국제 운송중" },
  { key: "customs", label: "통관중" },
  { key: "arrived_domestic", label: "국내 입고" },
  { key: "out_for_delivery", label: "국내 배송중" },
  { key: "delivered", label: "배송 완료" },
];

export const DEFAULT_STAGES_EN: Stage[] = [
  { key: "payment_confirmed", label: "Payment confirmed" },
  { key: "preparing", label: "Preparing order" },
  { key: "packed", label: "Packed" },
  { key: "shipped_overseas", label: "Shipped from origin" },
  { key: "in_transit", label: "In transit internationally" },
  { key: "customs", label: "Customs clearance" },
  { key: "arrived_domestic", label: "Arrived in destination country" },
  { key: "out_for_delivery", label: "Out for local delivery" },
  { key: "delivered", label: "Delivered" },
];

export const DEFAULT_STAGES = DEFAULT_STAGES_KO;

export function getDefaultStages(locale: Locale): Stage[] {
  return locale === "en" ? DEFAULT_STAGES_EN : DEFAULT_STAGES_KO;
}

async function inferShopLocale(shopDomain: string): Promise<Locale> {
  const session = await prisma.session.findFirst({
    where: { shop: shopDomain },
    orderBy: { id: "desc" },
  });
  return resolveLocale(session?.locale);
}

export async function getOrCreateShop(shopDomain: string, locale?: Locale) {
  const existing = await prisma.shop.findUnique({ where: { shopDomain } });
  if (existing) return existing;

  const resolvedLocale = locale ?? (await inferShopLocale(shopDomain));
  return prisma.shop.create({
    data: {
      shopDomain,
      stages: getDefaultStages(resolvedLocale),
    },
  });
}

export function getStages(shop: { stages: unknown }): Stage[] {
  if (Array.isArray(shop.stages) && shop.stages.length > 0) {
    return shop.stages as Stage[];
  }
  return DEFAULT_STAGES;
}

export async function ensureOrderTimeline(params: {
  shopDomain: string;
  shopifyOrderId: string;
  orderName: string;
  customerEmail?: string | null;
}) {
  const shop = await getOrCreateShop(params.shopDomain);
  const stages = getStages(shop);
  const firstStage = stages[0]?.key ?? DEFAULT_STAGES[0].key;

  return prisma.orderTimeline.upsert({
    where: {
      shopDomain_shopifyOrderId: {
        shopDomain: params.shopDomain,
        shopifyOrderId: params.shopifyOrderId,
      },
    },
    update: {},
    create: {
      shopDomain: params.shopDomain,
      shopifyOrderId: params.shopifyOrderId,
      orderName: params.orderName,
      customerEmail: params.customerEmail,
      currentStage: firstStage,
    },
  });
}

export function normalizeOrderName(raw: string) {
  const trimmed = raw.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

// Used by the storefront widget (via App Proxy). Requires the order name AND
// the email on file to match, so a visitor can't enumerate other customers'
// orders just by guessing order numbers.
export async function findPublicTimeline(params: {
  shopDomain: string;
  orderName: string;
  email: string;
}) {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: params.shopDomain },
  });
  if (!shop) return null;

  const timeline = await prisma.orderTimeline.findFirst({
    where: {
      shopDomain: params.shopDomain,
      orderName: normalizeOrderName(params.orderName),
      customerEmail: {
        equals: params.email.trim(),
        mode: "insensitive",
      },
    },
    include: { updates: { orderBy: { createdAt: "asc" } } },
  });
  if (!timeline) return null;

  return {
    stages: getStages(shop),
    currentStage: timeline.currentStage,
    hideBranding: shop.hideBranding,
    updates: timeline.updates.map((u) => ({
      stageKey: u.stageKey,
      note: u.note,
      photoUrl: u.photoUrl,
      at: u.createdAt,
    })),
  };
}

// Matches the retention commitment in the privacy policy: order timelines are
// kept for at most this long after their last update, then purged.
export const RETENTION_MONTHS = 24;

export async function purgeExpiredTimelines(now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);

  // StageUpdate rows cascade-delete via the OrderTimeline foreign key.
  const { count } = await prisma.orderTimeline.deleteMany({
    where: { updatedAt: { lt: cutoff } },
  });
  return count;
}

export async function setStage(params: {
  orderTimelineId: string;
  stageKey: string;
  note?: string;
  photoUrl?: string;
}) {
  const [timeline] = await prisma.$transaction([
    prisma.orderTimeline.update({
      where: { id: params.orderTimelineId },
      data: { currentStage: params.stageKey },
    }),
    prisma.stageUpdate.create({
      data: {
        orderTimelineId: params.orderTimelineId,
        stageKey: params.stageKey,
        note: params.note,
        photoUrl: params.photoUrl,
      },
    }),
  ]);
  return timeline;
}
