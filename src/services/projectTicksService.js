// src/services/projectTicksService.js
import { supabase } from "../supabaseClient";

/**
 * Tables (Phase 1)
 * - project_tick_meta:
 *   { project_id (pk), extra_days, updated_by, created_at, updated_at }
 *
 * - project_tick_cells:
 *   PK (project_id, task_id, tick_date)
 *   { project_id, task_id, tick_date, state(0|1|2), updated_by, updated_at }
 */

function assertSupabaseReady() {
  if (!supabase) {
    throw new Error(
      "[projectTicksService] Supabase is not configured. Check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY."
    );
  }
}

function toDateString(input) {
  if (!input) return null;
  if (input instanceof Date) return input.toISOString().slice(0, 10);
  if (typeof input !== "string") throw new Error("[projectTicksService] Invalid date input.");
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error(`[projectTicksService] Invalid date string: ${input}`);
  return d.toISOString().slice(0, 10);
}

async function getAuthUserIdOrNull() {
  assertSupabaseReady();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data?.user?.id || null;
}

const META_FIELDS = "project_id,extra_days,updated_by,created_at,updated_at";
const CELL_FIELDS = "project_id,task_id,tick_date,state,updated_by,updated_at";

/**
 * =========================
 * META
 * =========================
 */

export async function getProjectTickMeta(projectId) {
  assertSupabaseReady();
  if (!projectId) throw new Error("[projectTicksService] Missing projectId.");

  const { data, error } = await supabase
    .from("project_tick_meta")
    .select(META_FIELDS)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw error;

  // default if not exists
  return (
    data || {
      project_id: projectId,
      extra_days: 0,
      updated_by: null,
      created_at: null,
      updated_at: null,
    }
  );
}

export async function upsertProjectTickMeta(projectId, patch = {}) {
  assertSupabaseReady();
  if (!projectId) throw new Error("[projectTicksService] Missing projectId.");
  if (!patch || typeof patch !== "object") throw new Error("[projectTicksService] patch must be an object.");

  const uid = await getAuthUserIdOrNull();

  const row = {
    project_id: projectId,
    ...(patch || {}),
    // เติม updated_by อัตโนมัติถ้าไม่ส่งมา
    updated_by: patch.updated_by ?? uid ?? null,
  };

  // guard
  if ("extra_days" in row) {
    const n = Number(row.extra_days);
    row.extra_days = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  }

  const { data, error } = await supabase
    .from("project_tick_meta")
    .upsert(row, { onConflict: "project_id" })
    .select(META_FIELDS)
    .single();

  if (error) throw error;
  return data;
}

export async function setProjectTickExtraDays(projectId, extraDays) {
  return upsertProjectTickMeta(projectId, { extra_days: extraDays });
}

/**
 * =========================
 * CELLS
 * =========================
 */

/**
 * ดึง tick cells ของโปรเจกต์ (filter ช่วงวันที่ได้)
 * @param {string} projectId
 * @param {Object} [opts]
 * @param {string|Date} [opts.from]  YYYY-MM-DD
 * @param {string|Date} [opts.to]    YYYY-MM-DD
 * @param {string[]} [opts.taskIds]  filter เฉพาะ task_id ที่กำหนด
 * @param {number} [opts.limit=5000]
 */
export async function listProjectTickCells(projectId, opts = {}) {
  assertSupabaseReady();
  if (!projectId) throw new Error("[projectTicksService] Missing projectId.");

  const { from, to, taskIds, limit = 5000 } = opts;

  let q = supabase
    .from("project_tick_cells")
    .select(CELL_FIELDS)
    .eq("project_id", projectId);

  const fromDate = toDateString(from);
  const toDate = toDateString(to);

  if (fromDate) q = q.gte("tick_date", fromDate);
  if (toDate) q = q.lte("tick_date", toDate);

  if (Array.isArray(taskIds) && taskIds.length > 0) {
    q = q.in("task_id", taskIds);
  }

  q = q.order("tick_date", { ascending: true }).limit(limit);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/**
 * upsert tick cell 1 ช่อง
 * @param {Object} payload
 * @param {string} payload.project_id
 * @param {string} payload.task_id
 * @param {string|Date} payload.tick_date
 * @param {0|1|2|number} payload.state
 * @param {string} [payload.updated_by] (optional)
 */
export async function upsertProjectTickCell(payload) {
  assertSupabaseReady();
  if (!payload || typeof payload !== "object") throw new Error("[projectTicksService] payload is required.");

  const { project_id, task_id } = payload;
  if (!project_id) throw new Error("[projectTicksService] Missing project_id.");
  if (!task_id) throw new Error("[projectTicksService] Missing task_id.");

  const tick_date = toDateString(payload.tick_date);
  if (!tick_date) throw new Error("[projectTicksService] Missing tick_date.");

  const uid = await getAuthUserIdOrNull();

  const stateNum = Number(payload.state);
  const state =
    stateNum === 0 || stateNum === 1 || stateNum === 2 ? stateNum : 0;

  const row = {
    project_id,
    task_id,
    tick_date,
    state,
    updated_by: payload.updated_by ?? uid ?? null,
  };

  const { data, error } = await supabase
    .from("project_tick_cells")
    .upsert(row, { onConflict: "project_id,task_id,tick_date" })
    .select(CELL_FIELDS)
    .single();

  if (error) throw error;
  return data;
}

/**
 * bulk upsert หลายช่องในครั้งเดียว (เร็วกว่า)
 * @param {Array<Object>} cells
 * each: { project_id, task_id, tick_date, state, updated_by? }
 */
export async function bulkUpsertProjectTickCells(cells = []) {
  assertSupabaseReady();
  if (!Array.isArray(cells)) throw new Error("[projectTicksService] cells must be an array.");
  if (cells.length === 0) return [];

  const uid = await getAuthUserIdOrNull();

  const rows = cells.map((c) => {
    const tick_date = toDateString(c.tick_date);
    const stateNum = Number(c.state);
    const state =
      stateNum === 0 || stateNum === 1 || stateNum === 2 ? stateNum : 0;

    return {
      project_id: c.project_id,
      task_id: c.task_id,
      tick_date,
      state,
      updated_by: c.updated_by ?? uid ?? null,
    };
  });

  // basic validation
  for (const r of rows) {
    if (!r.project_id || !r.task_id || !r.tick_date) {
      throw new Error("[projectTicksService] bulkUpsert: missing project_id/task_id/tick_date in some rows.");
    }
  }

  const { data, error } = await supabase
    .from("project_tick_cells")
    .upsert(rows, { onConflict: "project_id,task_id,tick_date" })
    .select(CELL_FIELDS);

  if (error) throw error;
  return data || [];
}

/**
 * ลบช่อง tick (ไม่ค่อยจำเป็น แต่เตรียมไว้)
 */
export async function deleteProjectTickCell(projectId, taskId, tickDate) {
  assertSupabaseReady();
  if (!projectId || !taskId) throw new Error("[projectTicksService] Missing projectId/taskId.");
  const d = toDateString(tickDate);
  if (!d) throw new Error("[projectTicksService] Missing tickDate.");

  const { error } = await supabase
    .from("project_tick_cells")
    .delete()
    .eq("project_id", projectId)
    .eq("task_id", taskId)
    .eq("tick_date", d);

  if (error) throw error;
  return true;
}
