// src/services/leaveService.js
import { supabase } from "../supabaseClient";

/**
 * Table: public.leave_requests (Phase 1)
 * - id uuid pk
 * - user_id uuid fk profiles(id)
 * - leave_type: 'sick' | 'business' | 'other'
 * - status: 'pending' | 'confirmed' | 'rejected' | 'cancelled'
 * - requested_for_day date (optional)
 * - from_date date, from_time time (optional)
 * - to_date date, to_time time (optional)
 * - reason text
 * - notify_to text (default 'all')
 * - decided_by uuid (profiles.id)
 * - decided_at timestamptz
 * - created_at/updated_at timestamptz
 */

function assertSupabaseReady() {
  if (!supabase) {
    throw new Error(
      "[leaveService] Supabase is not configured. Check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY."
    );
  }
}

function toDateString(input) {
  // Accept Date | "YYYY-MM-DD" | ISO string
  if (!input) return null;
  if (input instanceof Date) return input.toISOString().slice(0, 10);
  if (typeof input !== "string") throw new Error("[leaveService] Invalid date input.");
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error(`[leaveService] Invalid date string: ${input}`);
  return d.toISOString().slice(0, 10);
}

function normalizeTime(input) {
  // Accept null | "HH:MM" | "HH:MM:SS" | Date | ISO string
  if (input == null || input === "") return null;
  if (input instanceof Date) return input.toISOString().slice(11, 19);

  if (typeof input !== "string") throw new Error("[leaveService] Invalid time input.");

  // HH:MM or HH:MM:SS
  if (/^\d{2}:\d{2}$/.test(input)) return `${input}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(input)) return input;

  // Try parse ISO-like string
  const d = new Date(input);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(11, 19);

  throw new Error(`[leaveService] Invalid time string: ${input}`);
}

async function getAuthUserIdOrThrow() {
  assertSupabaseReady();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const uid = data?.user?.id;
  if (!uid) throw new Error("[leaveService] Not authenticated.");
  return uid;
}

const SELECT_FIELDS =
  "id,user_id,leave_type,status,requested_for_day,from_date,from_time,to_date,to_time,reason,notify_to,decided_by,decided_at,created_at,updated_at";

/**
 * List leave requests.
 * - date filter = overlap with [from, to] by (from_date <= to) AND (to_date >= from)
 *
 * @param {Object} [opts]
 * @param {string} [opts.status] pending|confirmed|rejected|cancelled
 * @param {string} [opts.userId] filter by owner
 * @param {string|Date} [opts.from] range start date (YYYY-MM-DD)
 * @param {string|Date} [opts.to] range end date (YYYY-MM-DD)
 * @param {number} [opts.limit=200]
 * @param {string} [opts.orderBy='created_at']
 * @param {boolean} [opts.ascending=false]
 */
export async function listLeaveRequests(opts = {}) {
  assertSupabaseReady();
  const {
    status,
    userId,
    from,
    to,
    limit = 200,
    orderBy = "created_at",
    ascending = false,
  } = opts;

  let q = supabase.from("leave_requests").select(SELECT_FIELDS);

  if (status) q = q.eq("status", status);
  if (userId) q = q.eq("user_id", userId);

  const fromDate = toDateString(from);
  const toDate = toDateString(to);

  // overlap filter
  if (toDate) q = q.lte("from_date", toDate);
  if (fromDate) q = q.gte("to_date", fromDate);

  q = q.order(orderBy, { ascending }).limit(limit);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/**
 * Get leave request by id
 */
export async function getLeaveRequestById(id) {
  assertSupabaseReady();
  if (!id) throw new Error("[leaveService] Missing leave request id.");

  const { data, error } = await supabase
    .from("leave_requests")
    .select(SELECT_FIELDS)
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Create leave request (default status = pending).
 * @param {Object} payload
 */
export async function createLeaveRequest(payload) {
  assertSupabaseReady();
  if (!payload || typeof payload !== "object") {
    throw new Error("[leaveService] createLeaveRequest: payload is required.");
  }

  const uid = payload.user_id || (await getAuthUserIdOrThrow());

  const leave_type = payload.leave_type;
  if (!leave_type || !["sick", "business", "other"].includes(leave_type)) {
    throw new Error("[leaveService] leave_type must be one of: sick, business, other.");
  }

  const from_date = toDateString(payload.from_date);
  const to_date = toDateString(payload.to_date);

  if (!from_date || !to_date) {
    throw new Error("[leaveService] from_date and to_date are required (YYYY-MM-DD).");
  }

  const row = {
    user_id: uid,
    leave_type,
    status: payload.status && ["pending", "confirmed", "rejected", "cancelled"].includes(payload.status)
      ? payload.status
      : "pending",
    requested_for_day: toDateString(payload.requested_for_day),
    from_date,
    from_time: normalizeTime(payload.from_time),
    to_date,
    to_time: normalizeTime(payload.to_time),
    reason: typeof payload.reason === "string" ? payload.reason : "",
    notify_to: typeof payload.notify_to === "string" && payload.notify_to ? payload.notify_to : "all",
    decided_by: payload.decided_by ?? null,
    decided_at: payload.decided_at ?? null,
  };

  const { data, error } = await supabase
    .from("leave_requests")
    .insert(row)
    .select(SELECT_FIELDS)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update leave request with patch fields.
 * Note: RLS จะบังคับเองว่าใครแก้ได้ (เจ้าของ หรือ supervisor)
 */
export async function updateLeaveRequest(id, patch = {}) {
  assertSupabaseReady();
  if (!id) throw new Error("[leaveService] updateLeaveRequest: missing id.");
  if (!patch || typeof patch !== "object") throw new Error("[leaveService] updateLeaveRequest: patch must be object.");

  const clean = { ...patch };

  // normalize known fields
  if ("requested_for_day" in clean) clean.requested_for_day = toDateString(clean.requested_for_day);
  if ("from_date" in clean) clean.from_date = toDateString(clean.from_date);
  if ("to_date" in clean) clean.to_date = toDateString(clean.to_date);
  if ("from_time" in clean) clean.from_time = normalizeTime(clean.from_time);
  if ("to_time" in clean) clean.to_time = normalizeTime(clean.to_time);

  const { data, error } = await supabase
    .from("leave_requests")
    .update(clean)
    .eq("id", id)
    .select(SELECT_FIELDS)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Supervisor actions
 */
export async function confirmLeaveRequest(id) {
  const decidedBy = await getAuthUserIdOrThrow();
  return updateLeaveRequest(id, {
    status: "confirmed",
    decided_by: decidedBy,
    decided_at: new Date().toISOString(),
  });
}

export async function rejectLeaveRequest(id, reason = "") {
  const decidedBy = await getAuthUserIdOrThrow();
  return updateLeaveRequest(id, {
    status: "rejected",
    decided_by: decidedBy,
    decided_at: new Date().toISOString(),
    // ถ้าคุณอยากเก็บเหตุผลการ reject แนะนำเก็บใน reason ต่อท้าย
    reason: typeof reason === "string" ? reason : "",
  });
}

/**
 * Owner action
 */
export async function cancelLeaveRequest(id) {
  // เจ้าของหรือ supervisor ก็ได้ (ตาม policy)
  return updateLeaveRequest(id, {
    status: "cancelled",
  });
}
