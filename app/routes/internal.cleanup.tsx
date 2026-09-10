import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { purgeExpiredTimelines, RETENTION_MONTHS } from "../models/timeline.server";

function isAuthorized(request: Request) {
  const expected = process.env.CLEANUP_SECRET;
  if (!expected) return false;

  const provided = request.headers.get("x-cleanup-secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Called on a schedule (e.g. Google Cloud Scheduler, daily) to enforce the
// retention window documented in the privacy policy. Not linked from any UI —
// protected by a shared secret header instead of a Shopify session.
export const action = async ({ request }: ActionFunctionArgs) => {
  if (!isAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const deleted = await purgeExpiredTimelines();
  return Response.json({ ok: true, deleted, retentionMonths: RETENTION_MONTHS });
};
