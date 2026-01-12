// src/services/actionLogsService.js
import { supabase } from "../supabaseClient";

/**
 * Table: public.action_logs
 * - id uuid pk
 * - created_at timestamptz default now()
 * - actor_id uuid
 * - actor_username text
 * - action_type text (เช่น 'tasks.update')
 * - topic text
 * - summary text
 * - entity_table text
 * - entity_id text
 * - meta jsonb
 *
 * RLS (ตามที่เราตั้งใน Step 2):
 * - SELECT: supervisor เท่านั้น
 * - INSERT/UPDATE/DELETE: ถูก revoke จาก client
 */

function assertSupabaseReady() {
  if (!supabase) {
    throw new Error(
      "[actionLogsService] Supabase is not configured. Check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY."
    );
  }
}

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function toISO(input) {
  // Accept: Date | ISO string | timestamptz string
  if (!input) return null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return input.toISOString();
  }
  if (typeof input !== "string") return null;

  const s = input.trim();
  if (!s) return null;

  // if already ISO-like, try parse
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();

  return null;
}

function sanitizeForOrLike(input) {
  // supabase .or() ใช้ comma เป็นตัวคั่นเงื่อนไข -> ต้องกัน comma
  return String(input || "")
    .trim()
    .replace(/[,%()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LOG_FIELDS =
  "id,created_at,actor_id,actor_username,action_type,topic,summary,entity_table,entity_id,meta";

/**
 * List action logs with filters + pagination (offset/range)
 *
 * @param {Object} [opts]
 * @param {string} [opts.actorUsername] filter by actor_username
 * @param {string} [opts.actorId] filter by actor_id (uuid)
 * @param {string} [opts.topic] filter by topic
 * @param {string} [opts.actionType] filter by action_type (exact match)
 * @param {string|Date} [opts.from] created_at >= from (ISO / Date)
 * @param {string|Date} [opts.to] created_at <= to (ISO / Date)
 * @param {string} [opts.keyword] search in topic/summary/action_type (ILIKE)
 * @param {number} [opts.limit=50] page size (1..500)
 * @param {number} [opts.offset=0] offset (>=0)
 * @param {number} [opts.page] optional page number (0-based). If provided and offset is undefined -> offset = page*limit
 *
 * @returns {Promise<{ rows: any[], count: number|null, hasMore: boolean, limit: number, offset: number }>}
 */
export async function listActionLogs(opts = {}) {
  assertSupabaseReady();

  const limit = clampInt(opts.limit ?? 50, 1, 500, 50);

  const offset =
    typeof opts.offset === "number"
      ? clampInt(opts.offset, 0, Number.MAX_SAFE_INTEGER, 0)
      : typeof opts.page === "number"
        ? clampInt(opts.page, 0, Number.MAX_SAFE_INTEGER, 0) * limit
        : 0;

  const rangeFrom = offset;
  const rangeTo = offset + limit - 1;

  let q = supabase
    .from("action_logs")
    .select(LOG_FIELDS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (opts.actorUsername) q = q.eq("actor_username", opts.actorUsername);
  if (opts.actorId) q = q.eq("actor_id", opts.actorId);
  if (opts.topic) q = q.eq("topic", opts.topic);
  if (opts.actionType) q = q.eq("action_type", opts.actionType);

  const fromISO = toISO(opts.from);
  const toISOv = toISO(opts.to);

  if (fromISO) q = q.gte("created_at", fromISO);
  if (toISOv) q = q.lte("created_at", toISOv);

  const kw = sanitizeForOrLike(opts.keyword);
  if (kw) {
    // ค้นแบบง่าย (เร็วด้วย trigram index ที่เราสร้างไว้)
    q = q.or(`topic.ilike.%${kw}%,summary.ilike.%${kw}%,action_type.ilike.%${kw}%`);
  }

  const { data, error, count } = await q;
  if (error) throw error;

  const rows = data || [];
  const hasMore = rows.length === limit;

  return {
    rows,
    count: typeof count === "number" ? count : null,
    hasMore,
    limit,
    offset,
  };
}

/**
 * Quick helper: ดึงรายการ topic ที่มีอยู่ (ใช้ทำ dropdown)
 * @param {Object} [opts]
 * @param {number} [opts.limit=500]
 * @returns {Promise<string[]>}
 */
export async function listActionLogTopics(opts = {}) {
  assertSupabaseReady();
  const limit = clampInt(opts.limit ?? 500, 1, 2000, 500);

  const { data, error } = await supabase
    .from("action_logs")
    .select("topic")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const uniq = new Set();
  (data || []).forEach((r) => {
    const t = String(r?.topic || "").trim();
    if (t) uniq.add(t);
  });

  return Array.from(uniq).sort((a, b) => a.localeCompare(b));
}

/**
 * Get one log by id (สำหรับดูรายละเอียด)
 * @param {string} id uuid
 */
export async function getActionLogById(id) {
  assertSupabaseReady();
  if (!id) throw new Error("[actionLogsService] Missing log id.");

  const { data, error } = await supabase
    .from("action_logs")
    .select(LOG_FIELDS)
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}
