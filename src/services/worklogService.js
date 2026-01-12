// src/services/worklogService.js
import { supabase } from "../supabaseClient";

/**
 * Tables (Phase 1)
 * - weekly_plans: (user_id, week_start) unique
 *   { id, user_id, week_start, days(jsonb), locked, locked_at, created_at, updated_at }
 *
 * - worklog_logs: (user_id, log_date) unique
 *   { id, user_id, log_date, clock_in, clock_out, data(jsonb), created_at, updated_at }
 *
 * - reflections: (user_id, ref_date) unique
 *   { id, user_id, ref_date, mood, text, saved_at, created_at, updated_at }
 */

function assertSupabaseReady() {
  if (!supabase) {
    throw new Error(
      "[worklogService] Supabase is not configured. Check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY."
    );
  }
}

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function toDateString(input) {
  // Accept Date | "YYYY-MM-DD" | ISO string
  if (!input) throw new Error("[worklogService] Missing date input.");
  if (input instanceof Date) return input.toISOString().slice(0, 10);
  if (typeof input !== "string") throw new Error("[worklogService] Invalid date input.");
  // If already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  // Try parse ISO / other date strings
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error(`[worklogService] Invalid date string: ${input}`);
  return d.toISOString().slice(0, 10);
}

async function getAuthUserIdOrThrow() {
  assertSupabaseReady();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const uid = data?.user?.id;
  if (!uid) throw new Error("[worklogService] Not authenticated.");
  return uid;
}

/**
 * =========================
 * WEEKLY PLANS
 * =========================
 */

export async function fetchWeeklyPlan(userId, weekStart) {
  assertSupabaseReady();
  const uid = userId || (await getAuthUserIdOrThrow());
  const ws = toDateString(weekStart);

  const { data, error } = await supabase
    .from("weekly_plans")
    .select("id,user_id,week_start,days,locked,locked_at,created_at,updated_at")
    .eq("user_id", uid)
    .eq("week_start", ws)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function getWeeklyPlan(userId, weekStart) {
  const uid = userId || (await getAuthUserIdOrThrow());
  const ws = toDateString(weekStart);

  const existing = await fetchWeeklyPlan(uid, ws);
  if (existing) {
    return {
      ...existing,
      days: isPlainObject(existing.days) ? existing.days : {},
    };
  }

  // default object (ยังไม่ insert)
  return {
    id: null,
    user_id: uid,
    week_start: ws,
    days: {},
    locked: false,
    locked_at: null,
    created_at: null,
    updated_at: null,
  };
}

export async function upsertWeeklyPlan(payload) {
  assertSupabaseReady();
  if (!payload || !payload.week_start) throw new Error("[worklogService] weekly_plans: missing week_start.");

  const uid = payload.user_id || (await getAuthUserIdOrThrow());
  const ws = toDateString(payload.week_start);

  const row = {
    user_id: uid,
    week_start: ws,
    days: isPlainObject(payload.days) ? payload.days : {},
    locked: Boolean(payload.locked ?? false),
    locked_at: payload.locked_at ?? null,
  };

  const { data, error } = await supabase
    .from("weekly_plans")
    .upsert(row, { onConflict: "user_id,week_start" })
    .select("id,user_id,week_start,days,locked,locked_at,created_at,updated_at")
    .single();

  if (error) throw error;
  return { ...data, days: isPlainObject(data.days) ? data.days : {} };
}

/**
 * Patch days map without overwriting whole plan accidentally.
 * patch can be:
 * - object: { "YYYY-MM-DD": {...}, ... }
 * - function: (prevDays) => nextDays
 */
export async function patchWeeklyPlanDays(userId, weekStart, patch) {
  const plan = await getWeeklyPlan(userId, weekStart);
  const prevDays = isPlainObject(plan.days) ? plan.days : {};

  let nextDays;
  if (typeof patch === "function") {
    nextDays = patch(prevDays);
  } else if (isPlainObject(patch)) {
    nextDays = { ...prevDays, ...patch };
  } else {
    throw new Error("[worklogService] patchWeeklyPlanDays: patch must be object or function.");
  }

  if (!isPlainObject(nextDays)) nextDays = {};

  return upsertWeeklyPlan({
    user_id: plan.user_id,
    week_start: plan.week_start,
    days: nextDays,
    locked: plan.locked,
    locked_at: plan.locked_at,
  });
}

export async function setWeeklyPlanLocked(userId, weekStart, locked) {
  const plan = await getWeeklyPlan(userId, weekStart);
  const nowIso = new Date().toISOString();

  return upsertWeeklyPlan({
    user_id: plan.user_id,
    week_start: plan.week_start,
    days: plan.days,
    locked: Boolean(locked),
    locked_at: locked ? nowIso : null,
  });
}

/**
 * =========================
 * WORKLOG LOGS (daily)
 * =========================
 */

export async function fetchWorklogLog(userId, logDate) {
  assertSupabaseReady();
  const uid = userId || (await getAuthUserIdOrThrow());
  const d = toDateString(logDate);

  const { data, error } = await supabase
    .from("worklog_logs")
    .select("id,user_id,log_date,clock_in,clock_out,data,created_at,updated_at")
    .eq("user_id", uid)
    .eq("log_date", d)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function getWorklogLog(userId, logDate) {
  const uid = userId || (await getAuthUserIdOrThrow());
  const d = toDateString(logDate);

  const existing = await fetchWorklogLog(uid, d);
  if (existing) {
    return {
      ...existing,
      data: isPlainObject(existing.data) ? existing.data : {},
    };
  }

  return {
    id: null,
    user_id: uid,
    log_date: d,
    clock_in: null,
    clock_out: null,
    data: {},
    created_at: null,
    updated_at: null,
  };
}

export async function upsertWorklogLog(payload) {
  assertSupabaseReady();
  if (!payload || !payload.log_date) throw new Error("[worklogService] worklog_logs: missing log_date.");

  const uid = payload.user_id || (await getAuthUserIdOrThrow());
  const d = toDateString(payload.log_date);

  const row = {
    user_id: uid,
    log_date: d,
    clock_in: payload.clock_in ?? null,
    clock_out: payload.clock_out ?? null,
    data: isPlainObject(payload.data) ? payload.data : {},
  };

  const { data, error } = await supabase
    .from("worklog_logs")
    .upsert(row, { onConflict: "user_id,log_date" })
    .select("id,user_id,log_date,clock_in,clock_out,data,created_at,updated_at")
    .single();

  if (error) throw error;
  return { ...data, data: isPlainObject(data.data) ? data.data : {} };
}

export async function patchWorklogData(userId, logDate, patch) {
  const log = await getWorklogLog(userId, logDate);
  const prev = isPlainObject(log.data) ? log.data : {};

  let next;
  if (typeof patch === "function") {
    next = patch(prev);
  } else if (isPlainObject(patch)) {
    next = { ...prev, ...patch };
  } else {
    throw new Error("[worklogService] patchWorklogData: patch must be object or function.");
  }
  if (!isPlainObject(next)) next = {};

  return upsertWorklogLog({
    user_id: log.user_id,
    log_date: log.log_date,
    clock_in: log.clock_in,
    clock_out: log.clock_out,
    data: next,
  });
}

export async function setClockIn(userId, logDate, clockInIso = new Date().toISOString()) {
  const log = await getWorklogLog(userId, logDate);
  return upsertWorklogLog({
    user_id: log.user_id,
    log_date: log.log_date,
    clock_in: clockInIso,
    clock_out: log.clock_out ?? null,
    data: log.data,
  });
}

export async function setClockOut(userId, logDate, clockOutIso = new Date().toISOString()) {
  const log = await getWorklogLog(userId, logDate);
  return upsertWorklogLog({
    user_id: log.user_id,
    log_date: log.log_date,
    clock_in: log.clock_in ?? null,
    clock_out: clockOutIso,
    data: log.data,
  });
}

/**
 * =========================
 * REFLECTIONS (daily)
 * =========================
 */

export async function fetchReflection(userId, refDate) {
  assertSupabaseReady();
  const uid = userId || (await getAuthUserIdOrThrow());
  const d = toDateString(refDate);

  const { data, error } = await supabase
    .from("reflections")
    .select("id,user_id,ref_date,mood,text,saved_at,created_at,updated_at")
    .eq("user_id", uid)
    .eq("ref_date", d)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function getReflection(userId, refDate) {
  const uid = userId || (await getAuthUserIdOrThrow());
  const d = toDateString(refDate);

  const existing = await fetchReflection(uid, d);
  if (existing) return existing;

  return {
    id: null,
    user_id: uid,
    ref_date: d,
    mood: "",
    text: "",
    saved_at: null,
    created_at: null,
    updated_at: null,
  };
}

export async function upsertReflection(payload) {
  assertSupabaseReady();
  if (!payload || !payload.ref_date) throw new Error("[worklogService] reflections: missing ref_date.");

  const uid = payload.user_id || (await getAuthUserIdOrThrow());
  const d = toDateString(payload.ref_date);

  const row = {
    user_id: uid,
    ref_date: d,
    mood: typeof payload.mood === "string" ? payload.mood : "",
    text: typeof payload.text === "string" ? payload.text : "",
    // important: update saved_at every save
    saved_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("reflections")
    .upsert(row, { onConflict: "user_id,ref_date" })
    .select("id,user_id,ref_date,mood,text,saved_at,created_at,updated_at")
    .single();

  if (error) throw error;
  return data;
}
