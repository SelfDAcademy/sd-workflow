// src/pages/WorklogPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useTasks } from "../TaskStore";
import { supabase } from "../supabaseClient";

import { getMyProfile, listProfiles } from "../services/profileService";
import {
  getWeeklyPlan,
  upsertWeeklyPlan,
  getWorklogLog,
  setClockIn,
  setClockOut,
  upsertWorklogLog,
  upsertReflection,
} from "../services/worklogService";
import { listLeaveRequests, createLeaveRequest } from "../services/leaveService";

// NOTE: ตอนนี้ Source of Truth ของ Worklog อยู่บน Supabase แล้ว
// localStorage ถูกใช้เฉพาะ "Import local data" (one-time) เท่านั้น
const LS_WEEKLY_PLAN = "sdwf_weekly_plan_v3";
const LS_LOGS = "sdwf_worklog_logs_v3";
const LS_LEAVE_REQUESTS = "sdwf_leave_requests_v2";
const LS_REFLECTIONS = "sdwf_reflections_v1";
const LS_IMPORT_DONE = "sdwf_import_done_v1";

const USER_TYPE = {
  meen: "full_time",
  boy: "full_time",
  namtip: "full_time",
  tong: "full_time",
  art: "part_time",
  yung: "part_time",
  fah: "full_time",
  pluem: "full_time",
};

const LATE_GRACE_MINUTES = 5;

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TZ = "Asia/Bangkok";

const WORK_MOODS = [
  { key: "🔥", label: "พร้อมลุย" },
  { key: "🙂", label: "ปกติ" },
  { key: "😴", label: "พลังต่ำ" },
  { key: "🤝", label: "ต้องการ support" },
];

function parseJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function setJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function nowISO() {
  return new Date().toISOString();
}
function todayYMD() {
  try {
    // Always compute "today" in Thailand time to avoid UTC shift issues
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }
}

function utcDateFromYMD(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!m) return new Date(Date.UTC(1970, 0, 1));
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return new Date(Date.UTC(y, mo - 1, d));
}
function ymdFromUTCDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function addDaysYMD(ymd, days) {
  const d = utcDateFromYMD(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return ymdFromUTCDate(d);
}
function localDOW(ymd) {
  const d = utcDateFromYMD(ymd);
  return DOW[d.getUTCDay()];
}
function getWeekStartMonday(ymd) {
  const d = utcDateFromYMD(ymd);
  const day = d.getUTCDay(); // 0 Sun..6 Sat
  const diff = (day === 0 ? -6 : 1) - day; // Monday start
  d.setUTCDate(d.getUTCDate() + diff);
  return ymdFromUTCDate(d);
}

function minutesBetween(startHHMM, endHHMM) {
  if (!startHHMM || !endHHMM) return 0;
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  if ([sh, sm, eh, em].some((x) => Number.isNaN(x))) return 0;
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

function hhmmInTZFromISO(iso) {
  if (!iso) return null;

  const raw = String(iso).trim();
  const hasZone =
    /[zZ]$/.test(raw) ||
    /[+-]\d{2}:?\d{2}$/.test(raw) ||
    /[+-]\d{2}$/.test(raw);

  const normalized = (() => {
    const t = raw.includes(" ") && !raw.includes("T") ? raw.replace(" ", "T") : raw;
    return hasZone ? t : `${t}Z`;
  })();

  try {
    const dt = new Date(normalized);
    if (Number.isNaN(dt.getTime())) return null;

    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(dt);

    const h = Number(parts.find((p) => p.type === "hour")?.value);
    const m = Number(parts.find((p) => p.type === "minute")?.value);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return { h, m };
  } catch {
    const dt = new Date(normalized);
    if (Number.isNaN(dt.getTime())) return null;
    const h = (dt.getUTCHours() + 7) % 24;
    const m = dt.getUTCMinutes();
    return { h, m };
  }
}
function minutesFromISO(iso) {
  const t = hhmmInTZFromISO(iso);
  if (!t) return null;
  return t.h * 60 + t.m;
}
function timeFromISO(iso) {
  const t = hhmmInTZFromISO(iso);
  if (!t) return "-";
  return `${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}`;
}

function requirementWeekMinutes(username) {
  return USER_TYPE[username] === "full_time" ? 40 * 60 : 0;
}
function isFridayPlanningWindowNow() {
  const d = new Date();
  return d.getDay() === 5 && d.getHours() >= 12;
}
function defaultDay(username, ymd) {
  const day = new Date(`${ymd}T00:00:00`).getDay();
  const isWeekend = day === 0 || day === 6;
  if (isWeekend) return { type: "off", start: "", end: "", note: "", day_tasks: [], leave_req_id: "" };

  const isPT = USER_TYPE[username] === "part_time";
  return {
    type: "work",
    start: isPT ? "13:00" : "09:00",
    end: isPT ? "18:00" : "18:00",
    note: "",
    day_tasks: [],
    leave_req_id: "",
  };
}

function mergeWeekDays(weekStart, username, existingDays) {
  const days = {};
  for (let i = 0; i < 7; i++) {
    const d = addDaysYMD(weekStart, i);
    days[d] = { ...defaultDay(username, d), ...(existingDays?.[d] || {}) };
  }
  return days;
}

function Card({ title, children, scroll }) {
  return (
    <div style={card}>
      <div style={cardHeader}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>{title}</div>
      </div>
      <div style={{ padding: 10, overflowY: scroll ? "auto" : "visible", minHeight: 0 }}>{children}</div>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
function Modal({ title, children, onClose }) {
  return (
    <div style={modalBackdrop} onMouseDown={onClose}>
      <div style={modalCard} onMouseDown={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <strong>{title}</strong>
          <button onClick={onClose} style={btnSm}>
            Close
          </button>
        </div>
        <div style={{ padding: 12 }}>{children}</div>
      </div>
    </div>
  );
}

export default function WorklogPage() {
  const { tasks } = useTasks();

  // Auth/Profile
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState("");
  const [profiles, setProfiles] = useState([]);
  const [myProfile, setMyProfile] = useState(null);

  const actingUserId = myProfile?.id || "";
  const actingUser = myProfile?.username || "";
  const actingRole = myProfile?.role || "";
  const authEmail = myProfile?.email || "";

  // View selection
  const [viewUser, setViewUser] = useState("");

  // Time tick
  const [dayTick, setDayTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setDayTick((x) => x + 1), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  const today = useMemo(() => todayYMD(), [dayTick]);
  const todayDow = localDOW(today);

  const thisWeekStart = useMemo(() => getWeekStartMonday(today), [today]);
  const nextWeekStart = useMemo(() => addDaysYMD(thisWeekStart, 7), [thisWeekStart]);

  // mini calendar (last 14 days)
  const miniDays = useMemo(() => {
    const out = [];
    for (let i = 13; i >= 0; i--) out.push(addDaysYMD(today, -i));
    return out;
  }, [today]);

  // plan mode
  const [planMode, setPlanMode] = useState("this");
  const weekStart = planMode === "next" ? nextWeekStart : thisWeekStart;
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysYMD(weekStart, i)),
    [weekStart]
  );

  const planUser = viewUser || actingUser || "";
  const viewProfile = useMemo(() => profiles.find((p) => p.username === planUser) || null, [profiles, planUser]);
  const viewUserId = viewProfile?.id || "";

  const canEditSelf = Boolean(actingUserId && viewUserId && actingUserId === viewUserId);

  const [refreshTick, setRefreshTick] = useState(0);

  // ===== DB states =====
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState("");
  const [draftPlan, setDraftPlan] = useState({ locked: false, locked_at: "", days: {} });

  const [todayWeekDays, setTodayWeekDays] = useState({});
  const todayPlan = useMemo(() => {
    if (!planUser) return null;
    const d = todayWeekDays?.[today] || defaultDay(planUser, today);
    return d;
  }, [todayWeekDays, today, planUser]);

  const [todayLog, setTodayLog] = useState(null);

  const [logs30, setLogs30] = useState([]);
  const [weekPlansForStats, setWeekPlansForStats] = useState({}); // { weekStart: {date: dayObj} }

  const [leaveRequests, setLeaveRequests] = useState([]);

  // reflections (by date for the selected view user)
  const [reflectionsByDate, setReflectionsByDate] = useState({});
  const [refDraft, setRefDraft] = useState({ mood: "", text: "" });
  const refDraftDirtyRef = useRef(false);

  const [refViewDay, setRefViewDay] = useState("");
  const [refViewOpen, setRefViewOpen] = useState(false);

  // UI modals
  const [manageOpen, setManageOpen] = useState(false);
  const [manageDay, setManageDay] = useState("");

  const [sickOpen, setSickOpen] = useState(false);
  const [sickForm, setSickForm] = useState({
    from_date: today,
    from_time: "09:00",
    to_date: today,
    to_time: "18:00",
    reason: "",
  });

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveTargetDay, setLeaveTargetDay] = useState("");
  const [leaveForm, setLeaveForm] = useState({ from_date: "", from_time: "", to_date: "", to_time: "", reason: "" });

  // Import local -> DB
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState(null);
  const importDone = useMemo(() => parseJSON(LS_IMPORT_DONE, null), [importOpen]);

  // ===== Load my profile + profiles list =====
  useEffect(() => {
    let alive = true;
    (async () => {
      setProfilesLoading(true);
      setProfilesError("");
      try {
        const me = await getMyProfile({ createIfMissing: true });
        const all = await listProfiles({ orderBy: "username", ascending: true });

        if (!alive) return;
        setMyProfile(me);
        setProfiles(all || []);
      } catch (e) {
        if (!alive) return;
        setProfilesError(e?.message || String(e));
      } finally {
        if (!alive) return;
        setProfilesLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Default view user = myself
  useEffect(() => {
    if (!actingUser) return;
    setViewUser((prev) => (prev ? prev : actingUser));
  }, [actingUser]);

  // Reset reflection draft dirty flag when switching user/day
  useEffect(() => {
    refDraftDirtyRef.current = false;
    const item = reflectionsByDate?.[today];
    setRefDraft({ mood: item?.mood || "", text: item?.text || "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewUserId, today]);

  // ===== Fetch weekly plan for current planMode/weekStart =====
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!viewUserId || !planUser) return;
      setPlanLoading(true);
      setPlanError("");
      try {
        const p = await getWeeklyPlan(viewUserId, weekStart);

        if (!alive) return;

        const mergedDays = mergeWeekDays(weekStart, planUser, p?.days || {});
        setDraftPlan({
          locked: Boolean(p?.locked),
          locked_at: p?.locked_at ? String(p.locked_at) : "",
          days: mergedDays,
        });
      } catch (e) {
        if (!alive) return;
        setPlanError(e?.message || String(e));
        // fallback: build default plan so UI still usable for self
        const mergedDays = mergeWeekDays(weekStart, planUser, {});
        setDraftPlan({ locked: false, locked_at: "", days: mergedDays });
      } finally {
        if (!alive) return;
        setPlanLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [viewUserId, planUser, weekStart, refreshTick]);

  // ===== Fetch this week's plan (for Today card) =====
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!viewUserId || !planUser) return;
      try {
        const p = await getWeeklyPlan(viewUserId, thisWeekStart);
        if (!alive) return;
        const merged = mergeWeekDays(thisWeekStart, planUser, p?.days || {});
        setTodayWeekDays(merged);
      } catch {
        if (!alive) return;
        setTodayWeekDays(mergeWeekDays(thisWeekStart, planUser, {}));
      }
    })();
    return () => {
      alive = false;
    };
  }, [viewUserId, planUser, thisWeekStart, refreshTick]);

  // ===== Fetch today's log (for Today card) =====
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!viewUserId) return;
      try {
        const log = await getWorklogLog(viewUserId, today);
        if (!alive) return;
        setTodayLog(log);
      } catch {
        if (!alive) return;
        setTodayLog(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [viewUserId, today, refreshTick]);

  // ===== Fetch reflections (last 14 days) =====
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!viewUserId) return;
      const from = addDaysYMD(today, -13);
      const to = today;

      try {
        const { data, error } = await supabase
          .from("reflections")
          .select("ref_date,mood,text,saved_at")
          .eq("user_id", viewUserId)
          .gte("ref_date", from)
          .lte("ref_date", to);

        if (error) throw error;

        const map = {};
        for (const r of data || []) {
          map[r.ref_date] = {
            mood: r.mood || "",
            text: r.text || "",
            saved_at: r.saved_at || "",
          };
        }

        if (!alive) return;
        setReflectionsByDate(map);

        // if user not typing, sync draft from DB
        if (!refDraftDirtyRef.current) {
          const t = map?.[today];
          setRefDraft({ mood: t?.mood || "", text: t?.text || "" });
        }
      } catch {
        if (!alive) return;
        setReflectionsByDate({});
      }
    })();
    return () => {
      alive = false;
    };
  }, [viewUserId, today, refreshTick]);

  // ===== Fetch leave requests (recent ~ 1 year window) =====
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!viewUserId) return;
      try {
        const from = addDaysYMD(today, -365);
        const to = addDaysYMD(today, 365);
        const rows = await listLeaveRequests({
          userId: viewUserId,
          from,
          to,
          limit: 200,
          orderBy: "created_at",
          ascending: false,
        });

        if (!alive) return;
        setLeaveRequests(rows || []);
      } catch {
        if (!alive) return;
        setLeaveRequests([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [viewUserId, today, refreshTick]);

  // ===== Fetch stats data (worklog logs last 30 days + plans of those weeks) =====
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!viewUserId || !planUser) {
        setLogs30([]);
        setWeekPlansForStats({});
        return;
      }

      const from = addDaysYMD(today, -29);
      const to = today;

      try {
        const { data: logsData, error } = await supabase
          .from("worklog_logs")
          .select("log_date,clock_in,clock_out")
          .eq("user_id", viewUserId)
          .gte("log_date", from)
          .lte("log_date", to);

        if (error) throw error;

        const logsNorm = (logsData || []).map((l) => ({
          log_date: l.log_date,
          clock_in: l.clock_in || null,
          clock_out: l.clock_out || null,
        }));

        const weekStarts = Array.from(new Set(logsNorm.map((l) => getWeekStartMonday(l.log_date))));
        const plansMap = {};

        if (weekStarts.length > 0) {
          const { data: planRows, error: planErr } = await supabase
            .from("weekly_plans")
            .select("week_start,days")
            .eq("user_id", viewUserId)
            .in("week_start", weekStarts);

          if (planErr) throw planErr;

          for (const ws of weekStarts) {
            const row = (planRows || []).find((r) => r.week_start === ws);
            const merged = mergeWeekDays(ws, planUser, row?.days || {});
            plansMap[ws] = merged;
          }
        }

        if (!alive) return;
        setLogs30(logsNorm);
        setWeekPlansForStats(plansMap);
      } catch {
        if (!alive) return;
        setLogs30([]);
        setWeekPlansForStats({});
      }
    })();
    return () => {
      alive = false;
    };
  }, [viewUserId, planUser, today, refreshTick]);

  const stats30 = useMemo(() => {
    if (!planUser) return { late: 0, missedOut: 0, absent: 0 };

    let late = 0;
    let missedOut = 0;
    let absent = 0;

    for (const l of logs30) {
      const ws = getWeekStartMonday(l.log_date);
      const dayPlan =
        weekPlansForStats?.[ws]?.[l.log_date] || defaultDay(planUser, l.log_date);

      if (dayPlan?.type === "work") {
        if (!l.clock_in) absent += 1;
        if (l.clock_in && !l.clock_out) missedOut += 1;

        if (dayPlan.start && l.clock_in) {
          const plannedStartMin = minutesBetween("00:00", dayPlan.start);
          const clockInMin = minutesFromISO(l.clock_in);
          if (clockInMin != null) {
            const lateMin = clockInMin - plannedStartMin;
            if (lateMin > LATE_GRACE_MINUTES) late += 1;
          }
        }
      }
    }
    return { late, missedOut, absent };
  }, [planUser, logs30, weekPlansForStats]);

  const canEditNextWeek = isFridayPlanningWindowNow();
  const canEditPlan = useMemo(() => {
    if (!actingUserId) return false;
    if (!canEditSelf) return false;
    if (draftPlan.locked) return false;
    if (planMode === "this") return true;
    return canEditNextWeek;
  }, [actingUserId, canEditSelf, draftPlan.locked, planMode, canEditNextWeek]);

  const banner = useMemo(() => {
    if (!actingUserId || planMode !== "next") return "";
    if (draftPlan.locked) return "✅ สัปดาห์หน้าถูกยืนยันแล้ว";
    if (canEditNextWeek) return "⚠️ เปิดให้ลงสัปดาห์หน้าเฉพาะศุกร์ 12:00–23:59 (Save แล้วล็อก)";
    return "🔒 สัปดาห์หน้ายังแก้ไม่ได้";
  }, [actingUserId, planMode, canEditNextWeek, draftPlan.locked]);

  const totalWeekMinutes = useMemo(() => {
    const days = draftPlan.days || {};
    let sum = 0;
    for (const d of weekDates) {
      const day = days[d] || defaultDay(planUser, d);
      if (day.type === "work") sum += minutesBetween(day.start, day.end);
    }
    return sum;
  }, [draftPlan, weekDates, planUser]);

  const reqWeekMin = useMemo(() => (planUser ? requirementWeekMinutes(planUser) : 0), [planUser]);
  const totalHoursLabel = `${Math.round((totalWeekMinutes / 60) * 10) / 10} / ${reqWeekMin / 60} hrs`;

  const ongoingTasks = useMemo(() => {
    if (!planUser) return [];
    return tasks.filter((t) => (t.doer === planUser || t.support === planUser) && !t.archived && !t.confirmed);
  }, [tasks, planUser]);

  function dayTaskNames(ymd) {
    const ids = draftPlan?.days?.[ymd]?.day_tasks || [];
    const titles = ids.map((id) => tasks.find((t) => t.id === id)?.task).filter(Boolean);
    return titles;
  }

  function toggleDayTask(ymd, taskId) {
    const next = JSON.parse(JSON.stringify(draftPlan));
    const day = next.days[ymd] || defaultDay(planUser, ymd);
    const arr = Array.isArray(day.day_tasks) ? day.day_tasks : [];
    const has = arr.includes(taskId);
    day.day_tasks = has ? arr.filter((x) => x !== taskId) : [...arr, taskId];
    next.days[ymd] = day;
    setDraftPlan(next);
  }

  function openLeaveForDay(ymd) {
    setLeaveTargetDay(ymd);
    setLeaveForm({ from_date: ymd, from_time: "09:00", to_date: ymd, to_time: "18:00", reason: "" });
    setLeaveOpen(true);
  }

  async function clockIn() {
    if (!canEditSelf) return alert("ดูของคนอื่นอยู่ แก้ไขไม่ได้");
    if (!actingUserId) return alert("ยังไม่ได้ login");
    if (todayLog?.clock_in) return alert("วันนี้ clock in แล้ว");

    try {
      const updated = await setClockIn(actingUserId, today, nowISO());
      setTodayLog(updated);
      setRefreshTick((x) => x + 1);
    } catch (e) {
      alert(e?.message || String(e));
    }
  }

  async function clockOut() {
    if (!canEditSelf) return alert("ดูของคนอื่นอยู่ แก้ไขไม่ได้");
    if (!actingUserId) return alert("ยังไม่ได้ login");
    if (!todayLog?.clock_in) return alert("ต้อง clock in ก่อน");
    if (todayLog?.clock_out) return alert("วันนี้ clock out แล้ว");

    try {
      const updated = await setClockOut(actingUserId, today, nowISO());
      setTodayLog(updated);
      setRefreshTick((x) => x + 1);
    } catch (e) {
      alert(e?.message || String(e));
    }
  }

  async function savePlan() {
    if (!canEditSelf) return alert("ดูของคนอื่นอยู่ แก้ไขไม่ได้");
    if (!actingUserId) return alert("ยังไม่ได้ login");
    if (!canEditPlan) return alert("ตอนนี้แก้ไขไม่ได้");
    if (USER_TYPE[planUser] === "full_time" && totalWeekMinutes < 40 * 60) {
      return alert(
        `ชั่วโมงทั้งสัปดาห์ยังไม่ถึง 40 ชั่วโมง (ตอนนี้ ${Math.round((totalWeekMinutes / 60) * 10) / 10} ชม.)`
      );
    }

    try {
      const locked = planMode === "next" ? true : Boolean(draftPlan.locked);
      const locked_at = locked ? nowISO() : null;

      await upsertWeeklyPlan({
        user_id: viewUserId,
        week_start: weekStart,
        days: draftPlan.days || {},
        locked,
        locked_at,
      });

      if (planMode === "next") {
        setDraftPlan((p) => ({ ...p, locked: true, locked_at: locked_at || "" }));
      }

      setRefreshTick((x) => x + 1);
      alert("บันทึกแผนแล้ว");
    } catch (e) {
      alert(e?.message || String(e));
    }
  }

  async function saveTodayReflection() {
    if (!canEditSelf) return alert("ดูของคนอื่นอยู่ แก้ไขไม่ได้");
    if (!actingUserId) return alert("ยังไม่ได้ login");
    if (!viewUserId) return alert("ยังไม่มี owner");

    try {
      const row = await upsertReflection({
        user_id: viewUserId,
        ref_date: today,
        mood: refDraft.mood || "",
        text: refDraft.text || "",
      });

      setReflectionsByDate((prev) => ({
        ...(prev || {}),
        [today]: {
          mood: row?.mood || refDraft.mood || "",
          text: row?.text || refDraft.text || "",
          saved_at: row?.saved_at || nowISO(),
        },
      }));

      refDraftDirtyRef.current = false;
      alert("Saved ✅");
      setRefreshTick((x) => x + 1);
    } catch (e) {
      alert(e?.message || String(e));
    }
  }

  async function submitBusinessLeave() {
    if (!canEditSelf) return alert("ดูของคนอื่นอยู่ แก้ไขไม่ได้");
    if (!actingUserId) return alert("ยังไม่ได้ login");
    if (!leaveForm.reason.trim()) return alert("กรุณาใส่เหตุผลลากิจ");

    // ลากิจต้องล่วงหน้าอย่างน้อย 3 วัน
    const from = utcDateFromYMD(leaveForm.from_date);
    const now = utcDateFromYMD(today);
    const diffDays = Math.floor((from.getTime() - now.getTime()) / 86400000);
    if (diffDays < 3) return alert("ลากิจต้องล่วงหน้าอย่างน้อย 3 วัน");

    try {
      const req = await createLeaveRequest({
        user_id: actingUserId,
        leave_type: "business",
        status: "pending",
        requested_for_day: leaveTargetDay,
        from_date: leaveForm.from_date,
        from_time: leaveForm.from_time || null,
        to_date: leaveForm.to_date,
        to_time: leaveForm.to_time || null,
        reason: leaveForm.reason,
        notify_to: "all",
      });

      setLeaveRequests((prev) => [req, ...(prev || [])]);

      // patch plan day to leave (pending) + persist immediately
      const next = JSON.parse(JSON.stringify(draftPlan));
      next.days[leaveTargetDay] = {
        ...(next.days[leaveTargetDay] || defaultDay(planUser, leaveTargetDay)),
        type: "leave",
        leave_req_id: req.id,
        note: "pending",
        start: "",
        end: "",
      };

      setDraftPlan(next);

      await upsertWeeklyPlan({
        user_id: viewUserId,
        week_start: weekStart,
        days: next.days || {},
        locked: Boolean(next.locked),
        locked_at: next.locked ? (next.locked_at || nowISO()) : null,
      });

      setLeaveOpen(false);
      setRefreshTick((x) => x + 1);
      alert("ส่งคำขอลากิจแล้ว (pending)");
    } catch (e) {
      alert(e?.message || String(e));
    }
  }

  async function submitSickLeave() {
    if (!canEditSelf) return alert("ดูของคนอื่นอยู่ แก้ไขไม่ได้");
    if (!actingUserId) return alert("ยังไม่ได้ login");
    if (!sickForm.reason.trim()) return alert("กรุณาใส่เหตุผล/อาการป่วย");

    try {
      const req = await createLeaveRequest({
        user_id: actingUserId,
        leave_type: "sick",
        status: "pending",
        requested_for_day: null,
        from_date: sickForm.from_date,
        from_time: sickForm.from_time || null,
        to_date: sickForm.to_date,
        to_time: sickForm.to_time || null,
        reason: sickForm.reason,
        notify_to: "all",
      });

      setLeaveRequests((prev) => [req, ...(prev || [])]);

      setSickOpen(false);
      setRefreshTick((x) => x + 1);
      alert("บันทึกลาป่วยแล้ว (pending)");
    } catch (e) {
      alert(e?.message || String(e));
    }
  }

  // ---------- Import local ----------
  function buildImportSummaryForUser(username) {
    const plans = parseJSON(LS_WEEKLY_PLAN, {});
    const logs = parseJSON(LS_LOGS, []);
    const refs = parseJSON(LS_REFLECTIONS, {});
    const leaves = parseJSON(LS_LEAVE_REQUESTS, []);

    const planKeys = Object.keys(plans || {}).filter((k) => k.startsWith(`${username}__`));
    const logRows = (Array.isArray(logs) ? logs : []).filter((l) => l?.user === username);
    const refKeys = Object.keys(refs || {}).filter((k) => k.startsWith(`${username}__`));
    const leaveRows = (Array.isArray(leaves) ? leaves : []).filter((r) => r?.user === username);

    return {
      planKeys: planKeys.length,
      logRows: logRows.length,
      refKeys: refKeys.length,
      leaveRows: leaveRows.length,
    };
  }

  function leaveSigFromRowLike(r) {
    return [
      r.leave_type || "",
      r.status || "",
      r.requested_for_day || "",
      r.from_date || "",
      r.from_time || "",
      r.to_date || "",
      r.to_time || "",
      (r.reason || "").trim(),
    ].join("|");
  }

  async function runImportLocalToDb() {
    if (!actingUserId || !actingUser) return alert("ยังไม่ได้ login");
    setImporting(true);

    try {
      const plans = parseJSON(LS_WEEKLY_PLAN, {});
      const logs = parseJSON(LS_LOGS, []);
      const refs = parseJSON(LS_REFLECTIONS, {});
      const leaves = parseJSON(LS_LEAVE_REQUESTS, []);

      let importedPlans = 0;
      let importedLogs = 0;
      let importedRefs = 0;
      let importedLeaves = 0;
      let skippedLeaves = 0;

      // 1) Weekly plans (upsert)
      for (const [k, v] of Object.entries(plans || {})) {
        if (!k.startsWith(`${actingUser}__`)) continue;
        const week = k.split("__")[1] || "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) continue;

        await upsertWeeklyPlan({
          user_id: actingUserId,
          week_start: week,
          days: v?.days && typeof v.days === "object" ? v.days : {},
          locked: Boolean(v?.locked),
          locked_at: v?.locked_at || null,
        });
        importedPlans += 1;
      }

      // 2) Logs (upsert)
      for (const l of Array.isArray(logs) ? logs : []) {
        if (l?.user !== actingUser) continue;
        const d = l?.date;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ""))) continue;

        await upsertWorklogLog({
          user_id: actingUserId,
          log_date: d,
          clock_in: l?.clock_in || null,
          clock_out: l?.clock_out || null,
          data: {},
        });
        importedLogs += 1;
      }

      // 3) Reflections (upsert)
      for (const [k, v] of Object.entries(refs || {})) {
        if (!k.startsWith(`${actingUser}__`)) continue;
        const d = k.split("__")[1] || "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;

        await upsertReflection({
          user_id: actingUserId,
          ref_date: d,
          mood: v?.mood || "",
          text: v?.text || "",
        });
        importedRefs += 1;
      }

      // 4) Leave requests (best-effort de-dup)
      const existing = await listLeaveRequests({
        userId: actingUserId,
        from: addDaysYMD(today, -730),
        to: addDaysYMD(today, 730),
        limit: 1000,
        orderBy: "created_at",
        ascending: false,
      });
      const sigSet = new Set((existing || []).map(leaveSigFromRowLike));

      for (const r of Array.isArray(leaves) ? leaves : []) {
        if (r?.user !== actingUser) continue;

        const payload = {
          user_id: actingUserId,
          leave_type: r.type === "sick" ? "sick" : "business",
          status: r.status || "pending",
          requested_for_day: r.requested_for_day || null,
          from_date: r.from_date,
          from_time: r.from_time || null,
          to_date: r.to_date,
          to_time: r.to_time || null,
          reason: r.reason || "",
          notify_to: r.notify_to || "all",
        };

        const sig = leaveSigFromRowLike(payload);
        if (sigSet.has(sig)) {
          skippedLeaves += 1;
          continue;
        }

        // create (no upsert key here)
        await createLeaveRequest(payload);
        sigSet.add(sig);
        importedLeaves += 1;
      }

      setJSON(LS_IMPORT_DONE, {
        user: actingUser,
        at: nowISO(),
        imported: {
          weekly_plans: importedPlans,
          worklog_logs: importedLogs,
          reflections: importedRefs,
          leave_requests: importedLeaves,
          leave_requests_skipped: skippedLeaves,
        },
      });

      alert(
        `Import สำเร็จ ✅\n` +
          `weekly_plans: ${importedPlans}\n` +
          `worklog_logs: ${importedLogs}\n` +
          `reflections: ${importedRefs}\n` +
          `leave_requests: ${importedLeaves} (skip ${skippedLeaves})`
      );

      setImportOpen(false);
      setRefreshTick((x) => x + 1);
    } catch (e) {
      alert(e?.message || String(e));
    } finally {
      setImporting(false);
    }
  }

  // Prepare import summary when open
  useEffect(() => {
    if (!importOpen || !actingUser) return;
    try {
      setImportSummary(buildImportSummaryForUser(actingUser));
    } catch {
      setImportSummary(null);
    }
  }, [importOpen, actingUser]);

  // ===== Render guards =====
  if (profilesLoading) {
    return (
      <main style={{ padding: 16 }}>
        <h2 style={{ margin: 0 }}>Worklog</h2>
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>Loading profiles...</div>
      </main>
    );
  }

  if (profilesError) {
    return (
      <main style={{ padding: 16 }}>
        <h2 style={{ margin: 0 }}>Worklog</h2>
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9, color: "#ffb4b4" }}>
          Error: {profilesError}
        </div>
      </main>
    );
  }

  if (!actingUserId || !actingUser) {
    return (
      <main style={{ padding: 16 }}>
        <h2 style={{ margin: 0 }}>Worklog</h2>
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
          ยังไม่พบ session ของผู้ใช้ (กรุณา login ใหม่)
        </div>
      </main>
    );
  }

  // ===== Main UI =====
  return (
    <main style={{ padding: 16, height: "calc(100vh - 120px)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Worklog</h2>
        <div style={{ opacity: 0.7, fontSize: 12 }}>Clock + Weekly Plan</div>

        <div
          style={{
            marginLeft: "auto",
            fontSize: 12,
            opacity: 0.85,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div>
            Login: <b>{actingUser || "-"}</b>
            {actingRole ? <span style={{ opacity: 0.8 }}> · {actingRole}</span> : null}
            {authEmail ? <span style={{ opacity: 0.7 }}> · {authEmail}</span> : null}
          </div>

          <button onClick={() => setImportOpen(true)} style={btnXs}>
            Import local
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ opacity: 0.8 }}>View</span>
            <select
              value={viewUser || ""}
              onChange={(e) => setViewUser(e.target.value)}
              disabled={!actingUser}
              style={{ ...selXs, width: 140 }}
            >
              <option value="" disabled>
                -
              </option>
              {profiles.map((p) => (
                <option key={p.id} value={p.username}>
                  {p.username}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "340px 1fr",
          gap: 12,
          height: "calc(100% - 52px)",
        }}
      >
        {/* LEFT */}
        <div style={{ display: "grid", gridTemplateRows: "auto 1fr 1fr", gap: 12, minHeight: 0 }}>
          <Card title="Reflection (Today)" scroll>
            <div style={{ display: "grid", gap: 2 }}>
              <div style={{ fontSize: 12, opacity: 0.85 }}>
                owner: <b>{planUser}</b> · date: <b>{today}</b>
              </div>

              <Field label="Work Mood">
                <select
                  value={refDraft.mood}
                  onChange={(e) => {
                    refDraftDirtyRef.current = true;
                    setRefDraft((p) => ({ ...p, mood: e.target.value }));
                  }}
                  disabled={!canEditSelf}
                  style={selSmall}
                >
                  <option value="">เลือก mood</option>
                  {WORK_MOODS.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.key} {m.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Reflection">
                <textarea
                  value={refDraft.text}
                  onChange={(e) => {
                    refDraftDirtyRef.current = true;
                    setRefDraft((p) => ({ ...p, text: e.target.value }));
                  }}
                  rows={2}
                  disabled={!canEditSelf}
                  style={{ ...inpSmall, height: "auto" }}
                  placeholder="วันนี้เรียนรู้อะไรเกี่ยวกับการทำงานบ้าง? / อะไรที่ทำได้ดี / อะไรที่อยากปรับ"
                />
              </Field>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={saveTodayReflection} style={btnXs} disabled={!canEditSelf}>
                  Save
                </button>
              </div>

              <div style={{ borderTop: "1px solid #2b2b2b", paddingTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                  Mini calendar (last 14 days)
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
                  {miniDays.map((d) => {
                    const item = reflectionsByDate?.[d];
                    const mood = item?.mood || "";
                    const bg = mood ? "rgba(56,189,248,0.15)" : "transparent";
                    return (
                      <div
                        key={d}
                        onClick={() => {
                          setRefViewDay(d);
                          setRefViewOpen(true);
                        }}
                        title={item ? `${d}\n${item.mood || ""}\n${(item.text || "").slice(0, 80)}` : d}
                        style={{
                          border: "1px solid #2b2b2b",
                          borderRadius: 10,
                          cursor: "pointer",
                          padding: "6px 6px",
                          minHeight: 40,
                          background: bg,
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                        }}
                      >
                        <div style={{ fontSize: 10, opacity: 0.75 }}>
                          {d.slice(8, 10)}/{d.slice(5, 7)}
                        </div>
                        <div style={{ fontSize: 10, lineHeight: 1 }}>{mood || "·"}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>

          <Card title={`Today (${todayDow} ${today})`} scroll>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: 12, opacity: 0.85 }}>
                planned:{" "}
                <b>
                  {todayPlan?.type === "work"
                    ? `${todayPlan.start || "-"} → ${todayPlan.end || "-"}`
                    : todayPlan?.type || "-"}
                </b>
              </div>

              <div style={{ fontSize: 12, opacity: 0.85 }}>
                clock in: <b>{todayLog?.clock_in ? timeFromISO(todayLog.clock_in) : "-"}</b>
              </div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>
                clock out: <b>{todayLog?.clock_out ? timeFromISO(todayLog.clock_out) : "-"}</b>
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={clockIn} style={btnXs} disabled={!canEditSelf}>
                  In
                </button>
                <button onClick={clockOut} style={btnXs} disabled={!canEditSelf}>
                  Out
                </button>
                <button onClick={() => setSickOpen(true)} style={btnWarnXs} disabled={!canEditSelf}>
                  Sick
                </button>
              </div>
            </div>
          </Card>

          <Card title="Leave requests" scroll>
            {leaveRequests.length === 0 ? (
              <div style={{ fontSize: 12, opacity: 0.7 }}>ยังไม่มีคำขอ</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {leaveRequests.slice(0, 20).map((r) => (
                  <div key={r.id} style={{ border: "1px solid #2b2b2b", borderRadius: 10, padding: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 12 }}>
                      {r.leave_type} · {r.status}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {r.from_date} {r.from_time || ""} → {r.to_date} {r.to_time || ""}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{r.reason}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT */}
        <div style={{ display: "grid", gridTemplateRows: "auto 1fr", gap: 12, minHeight: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <Card title="Weekly plan">
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 3 }}>{banner}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={() => setPlanMode("this")} style={planMode === "this" ? btnActive : btnXs}>
                  This week
                </button>
                <button onClick={() => setPlanMode("next")} style={planMode === "next" ? btnActive : btnXs}>
                  Next week
                </button>

                <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>
                    total: <b>{totalHoursLabel}</b>
                  </div>
                  <button onClick={savePlan} style={btnXs} disabled={!canEditPlan || planLoading}>
                    Save
                  </button>
                </div>

                <div style={{ width: "100%", fontSize: 12, opacity: 0.75 }}>
                  week start (Mon): <b>{weekStart}</b> · edit: <b>{canEditPlan ? "allowed" : "locked"}</b>
                  {planError ? <span style={{ marginLeft: 8, color: "#ffb4b4" }}> · {planError}</span> : null}
                </div>
              </div>
            </Card>

            <Card title="Stats (30 days)" scroll={false}>
              <div style={{ display: "grid", gap: 8, fontSize: 12, opacity: 0.9 }}>
                <div>
                  late: <b>{stats30.late}</b>
                </div>
                <div>
                  missed out: <b>{stats30.missedOut}</b>
                </div>
                <div>
                  absence: <b>{stats30.absent}</b>
                </div>
              </div>
            </Card>
          </div>

          <Card title="Plan table" scroll={false}>
            <div style={{ overflowX: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
                <thead>
                  <tr style={{ opacity: 0.85 }}>
                    <th style={{ ...thXs, width: "3%" }}>day</th>
                    <th style={{ ...thXs, width: "7%" }}>date</th>
                    <th style={{ ...thXs, width: "6.5%" }}>type</th>
                    <th style={{ ...thXs, width: "7.5%" }}>start</th>
                    <th style={{ ...thXs, width: "7.5%" }}>end</th>
                    <th style={{ ...thXs, width: "3.5%" }}>hrs</th>
                    <th style={{ ...thXs, width: "38%" }}>tasks</th>
                    <th style={{ ...thXs, width: "6%" }}>manage</th>
                    <th style={{ ...thXs, width: "20%" }}>note</th>
                  </tr>
                </thead>

                <tbody>
                  {weekDates.map((d) => {
                    const day = draftPlan?.days?.[d] || defaultDay(planUser, d);
                    const mins = day.type === "work" ? minutesBetween(day.start, day.end) : 0;
                    const hrs = (mins / 60).toFixed(2);
                    const leaveReq = day.leave_req_id ? leaveRequests.find((r) => r.id === day.leave_req_id) : null;
                    const names = dayTaskNames(d);

                    return (
                      <tr key={d}>
                        <td style={tdXs}>{localDOW(d)}</td>
                        <td style={tdXs}>{d}</td>

                        <td style={tdXs}>
                          <select
                            value={day.type || "work"}
                            disabled={!canEditPlan}
                            onChange={(e) => {
                              const next = JSON.parse(JSON.stringify(draftPlan));
                              next.days[d] = { ...(next.days[d] || defaultDay(planUser, d)), type: e.target.value };

                              if (e.target.value === "leave") openLeaveForDay(d);
                              if (e.target.value !== "work") {
                                next.days[d].start = "";
                                next.days[d].end = "";
                              }
                              setDraftPlan(next);
                            }}
                            style={selXs}
                          >
                            <option value="work">work</option>
                            <option value="off">off</option>
                            <option value="leave">leave</option>
                          </select>

                          {leaveReq ? (
                            <div style={{ marginTop: 2, fontSize: 12, opacity: 0.85 }}>{leaveReq.status}</div>
                          ) : null}
                        </td>

                        <td style={tdXs}>
                          <input
                            type="time"
                            value={day.start || ""}
                            disabled={!canEditPlan || day.type !== "work"}
                            onChange={(e) => {
                              const next = JSON.parse(JSON.stringify(draftPlan));
                              next.days[d] = { ...(next.days[d] || defaultDay(planUser, d)), start: e.target.value };
                              setDraftPlan(next);
                            }}
                            style={inpXs}
                          />
                        </td>

                        <td style={tdXs}>
                          <input
                            type="time"
                            value={day.end || ""}
                            disabled={!canEditPlan || day.type !== "work"}
                            onChange={(e) => {
                              const next = JSON.parse(JSON.stringify(draftPlan));
                              next.days[d] = { ...(next.days[d] || defaultDay(planUser, d)), end: e.target.value };
                              setDraftPlan(next);
                            }}
                            style={inpXs}
                          />
                        </td>

                        <td style={tdXs}>{day.type === "work" ? hrs : "-"}</td>

                        <td style={tdXs}>
                          {names.length === 0 ? (
                            <span style={{ opacity: 0.6 }}>-</span>
                          ) : (
                            <div style={{ display: "grid", gap: 2 }}>
                              {names.slice(0, 3).map((nm, i) => (
                                <div key={i} style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.1 }}>
                                  {nm}
                                </div>
                              ))}
                              {names.length > 3 ? (
                                <div style={{ fontSize: 12, opacity: 0.75 }}>+{names.length - 3} more</div>
                              ) : null}
                            </div>
                          )}
                        </td>

                        <td style={tdXs}>
                          <button
                            style={btnXs}
                            disabled={!canEditSelf}
                            onClick={() => {
                              setManageDay(d);
                              setManageOpen(true);
                            }}
                          >
                            manage
                          </button>
                        </td>

                        <td style={tdXs}>
                          <input
                            value={day.note || ""}
                            disabled={!canEditPlan}
                            onChange={(e) => {
                              const next = JSON.parse(JSON.stringify(draftPlan));
                              next.days[d] = { ...(next.days[d] || defaultDay(planUser, d)), note: e.target.value };
                              setDraftPlan(next);
                            }}
                            placeholder="optional"
                            style={{ ...inpXs, width: "100%" }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      {/* Reflection detail popup */}
      {refViewOpen && (
        <Modal title={`Reflection: ${refViewDay} (${localDOW(refViewDay)})`} onClose={() => setRefViewOpen(false)}>
          {(() => {
            const item = reflectionsByDate?.[refViewDay];
            if (!item) return <div style={{ fontSize: 12, opacity: 0.8 }}>ยังไม่มี reflection ของวันนี้</div>;

            const moodLabel = WORK_MOODS.find((m) => m.key === item.mood)?.label || "";
            return (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                  mood: <b>{item.mood}</b> {moodLabel ? `(${moodLabel})` : ""}
                </div>
                <div
                  style={{
                    border: "1px solid #2b2b2b",
                    borderRadius: 12,
                    padding: 10,
                    background: "#141a1f",
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.35,
                  }}
                >
                  {item.text || "-"}
                </div>
                <div style={{ fontSize: 12, opacity: 0.6 }}>saved: {item.saved_at ? timeFromISO(item.saved_at) : "-"}</div>
              </div>
            );
          })()}
        </Modal>
      )}

      {/* Manage tasks modal */}
      {manageOpen && canEditSelf && (
        <Modal title={`Manage tasks for ${manageDay} (${localDOW(manageDay)})`} onClose={() => setManageOpen(false)}>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>เลือกงาน ongoing แล้วผูกลงวันนั้น</div>
          {ongoingTasks.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.7 }}>ไม่มีงาน ongoing</div>
          ) : (
            <div style={{ display: "grid", gap: 8, maxHeight: 320, overflowY: "auto" }}>
              {ongoingTasks.map((t) => {
                const day = draftPlan?.days?.[manageDay] || defaultDay(planUser, manageDay);
                const picked = (day.day_tasks || []).includes(t.id);
                return (
                  <label key={t.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <input type="checkbox" checked={picked} onChange={() => toggleDayTask(manageDay, t.id)} />
                    <div style={{ fontSize: 12 }}>
                      <div style={{ fontWeight: 700 }}>{t.task}</div>
                      <div style={{ opacity: 0.75 }}>
                        {t.type} · dl {t.deadline}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            <button onClick={() => setManageOpen(false)} style={btnSm}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {/* Sick leave modal */}
      {sickOpen && canEditSelf && (
        <Modal title="Sick leave" onClose={() => setSickOpen(false)}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="from date">
                <input type="date" value={sickForm.from_date} onChange={(e) => setSickForm({ ...sickForm, from_date: e.target.value })} style={inp} />
              </Field>
              <Field label="from time">
                <input type="time" value={sickForm.from_time} onChange={(e) => setSickForm({ ...sickForm, from_time: e.target.value })} style={inp} />
              </Field>
              <Field label="to date">
                <input type="date" value={sickForm.to_date} onChange={(e) => setSickForm({ ...sickForm, to_date: e.target.value })} style={inp} />
              </Field>
              <Field label="to time">
                <input type="time" value={sickForm.to_time} onChange={(e) => setSickForm({ ...sickForm, to_time: e.target.value })} style={inp} />
              </Field>
            </div>

            <Field label="reason (symptoms)">
              <textarea value={sickForm.reason} onChange={(e) => setSickForm({ ...sickForm, reason: e.target.value })} rows={3} style={{ ...inp, width: "100%" }} />
            </Field>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setSickOpen(false)} style={btnSm}>
                Cancel
              </button>
              <button onClick={submitSickLeave} style={btnWarnSm}>
                Submit
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Business leave modal */}
      {leaveOpen && canEditSelf && (
        <Modal title={`Leave request (for ${leaveTargetDay})`} onClose={() => setLeaveOpen(false)}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="from date">
                <input type="date" value={leaveForm.from_date} onChange={(e) => setLeaveForm({ ...leaveForm, from_date: e.target.value })} style={inp} />
              </Field>
              <Field label="from time">
                <input type="time" value={leaveForm.from_time} onChange={(e) => setLeaveForm({ ...leaveForm, from_time: e.target.value })} style={inp} />
              </Field>
              <Field label="to date">
                <input type="date" value={leaveForm.to_date} onChange={(e) => setLeaveForm({ ...leaveForm, to_date: e.target.value })} style={inp} />
              </Field>
              <Field label="to time">
                <input type="time" value={leaveForm.to_time} onChange={(e) => setLeaveForm({ ...leaveForm, to_time: e.target.value })} style={inp} />
              </Field>
            </div>

            <Field label="reason">
              <textarea value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} rows={3} style={{ ...inp, width: "100%" }} />
            </Field>

            <div style={{ fontSize: 12, opacity: 0.75 }}>* ต้องลาล่วงหน้าอย่างน้อย 3 วัน</div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setLeaveOpen(false)} style={btnSm}>
                Cancel
              </button>
              <button onClick={submitBusinessLeave} style={btnWarnSm}>
                Submit
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Import modal */}
      {importOpen && (
        <Modal title="Import local worklog → Supabase" onClose={() => (importing ? null : setImportOpen(false))}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              จะดึงข้อมูลจาก localStorage ของเครื่องนี้ แล้ว upsert เข้า Supabase (เฉพาะ user: <b>{actingUser}</b>)
            </div>

            {importDone ? (
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                last import: <b>{importDone.at || "-"}</b> · user: <b>{importDone.user || "-"}</b>
              </div>
            ) : null}

            {importSummary ? (
              <div style={{ fontSize: 12, opacity: 0.9, display: "grid", gap: 4 }}>
                <div>weekly_plans (local keys): <b>{importSummary.planKeys}</b></div>
                <div>worklog_logs (local rows): <b>{importSummary.logRows}</b></div>
                <div>reflections (local keys): <b>{importSummary.refKeys}</b></div>
                <div>leave_requests (local rows): <b>{importSummary.leaveRows}</b></div>
              </div>
            ) : (
              <div style={{ fontSize: 12, opacity: 0.75 }}>ไม่พบข้อมูล local หรืออ่านไม่ได้</div>
            )}

            <div style={{ fontSize: 12, opacity: 0.7 }}>
              หมายเหตุ: weekly_plans / logs / reflections จะ upsert (ไม่ซ้ำ) ส่วน leave_requests จะพยายามกันซ้ำแบบ best-effort
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setImportOpen(false)} style={btnSm} disabled={importing}>
                Cancel
              </button>
              <button
                onClick={runImportLocalToDb}
                style={btnWarnSm}
                disabled={importing}
              >
                {importing ? "Importing..." : "Import now"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}

// ---- styles ----
const card = {
  border: "1px solid #2b2b2b",
  borderRadius: 12,
  background: "#141a1f",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  color: "white",
};
const cardHeader = {
  padding: "10px 12px",
  borderBottom: "1px solid #2b2b2b",
  display: "flex",
  alignItems: "baseline",
  gap: 8,
};

const selSmall = { padding: 6, borderRadius: 10, width: "100%", fontSize: 12 };
const inpSmall = { padding: 6, borderRadius: 10, width: "100%", fontSize: 12 };

const inp = { padding: 8, borderRadius: 10, width: "100%" };

const btnXs = { padding: "5px 8px", borderRadius: 10, cursor: "pointer", fontSize: 12 };
const btnWarnXs = { padding: "5px 8px", borderRadius: 10, cursor: "pointer", fontSize: 12 };
const btnSm = { padding: "6px 10px", borderRadius: 10, cursor: "pointer" };
const btnWarnSm = { padding: "6px 10px", borderRadius: 10, cursor: "pointer" };
const btnActive = {
  padding: "6px 10px",
  borderRadius: 10,
  cursor: "pointer",
  opacity: 1,
  background: "#0f1418",
  color: "white",
  border: "1px solid #2b2b2b",
};

const selXs = { padding: 4, borderRadius: 10, width: "100%", fontSize: 12 };
const inpXs = { padding: 4, borderRadius: 10, width: "100%", fontSize: 12 };

const thXs = { textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #2b2b2b", fontSize: 12, opacity: 0.85 };
const tdXs = { padding: "4px 6px", borderBottom: "1px solid #2b2b2b", verticalAlign: "top", fontSize: 12 };

const modalBackdrop = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 16,
};
const modalCard = {
  width: "min(820px, 100%)",
  background: "#0f1418",
  border: "1px solid #2b2b2b",
  borderRadius: 14,
  overflow: "hidden",
  color: "white",
};
const modalHeader = {
  padding: "10px 12px",
  borderBottom: "1px solid #2b2b2b",
  display: "flex",
  alignItems: "center",
  gap: 10,
};
