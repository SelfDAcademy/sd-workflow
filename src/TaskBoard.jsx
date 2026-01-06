import { useMemo, useRef, useState, useEffect } from "react";
import { PEOPLE } from "./config";
import { getSessionUser } from "./auth/auth";


const BU_OPTIONS = ["BU1", "BU2", "comp."];
const PROJECT_OPTIONS = ["DC", "DS", "DCP", "DCR", "SDJ", "SDF", "1:1", "SC", "comp."];
const TYPE_OPTIONS = ["routine", "add-on"];
const STATUS_OPTIONS = ["ongoing", "not started", "done"];
const SUPERVISORS = ["fah", "pluem", "namtip"];

const TZ = "Asia/Bangkok";
const LS_TASKBOARD_VIEW = "sdwf_taskboard_view_v1";

const SUP_PENDING_MAX_H = 160;
const SUP_FOLLOWUP_H = 320;
const SUP_GAP = 10;
const SUP_TOP_H = SUP_PENDING_MAX_H + SUP_GAP + SUP_FOLLOWUP_H;

// 🔗 must match WorklogPage storage keys
const LS_LEAVE_REQUESTS = "sdwf_leave_requests_v2";
const LS_WEEKLY_PLAN = "sdwf_weekly_plan_v3";

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

function projectCode(t) {
  return (
    t?.project_code ||
    t?.projectCode ||
    (typeof t?.project === "string" ? t.project : null) ||
    null
  );
}

function projectInstanceName(t) {
  // Prefer explicit instance/name fields (Projectboard-created projects often have these)
  const direct =
    t?.project_instance_name ||
    t?.projectInstanceName ||
    t?.project_instance ||
    t?.projectInstance ||
    t?.project_name ||
    t?.projectName ||
    t?.project_title ||
    t?.projectTitle ||
    t?.workflow_name ||
    t?.workflowName ||
    t?.project_display_name ||
    t?.projectDisplayName ||
    t?.project_label ||
    t?.projectLabel ||
    null;

  if (typeof direct === "string" && direct.trim()) return direct.trim();

  // Some implementations store a nested object in `project`
  if (t?.project && typeof t.project === "object") {
    const o = t.project;
    const nested =
      o?.name || o?.title || o?.project_name || o?.projectName || o?.label || o?.display_name;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }

  // Heuristic fallback: try to infer from task text if it contains a project instance pattern.
  // Example: "D-Camp14" / "D‑Camp14" / "D Camp14"
  const hay = String(t?.task || "");
  const m = hay.match(/\bD\s*[-‑–]?\s*Camp\s*\d+\b/i);
  if (m) return m[0].replace(/\s+/g, "").replace(/[-‑–]?Camp/i, "-Camp");

  return null;
}

function projectTag(t) {
  const code = projectCode(t);
  const name = projectInstanceName(t);

  if (name && code && name.toLowerCase() !== code.toLowerCase()) return `${name} (${code})`;
  return name || code || "";
}

function ymdFromDateInTZ(date) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    // fallback to local date
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }
}
function utcDateFromYMD(ymdStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymdStr || "").trim());
  if (!m) return new Date(Date.UTC(1970, 0, 1));
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}
function ymdFromUTCDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function newId() {
  try {
    return crypto.randomUUID();
  } catch {
    // fallback uuid v4-ish
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
function formatDate(ymd) {
  if (!ymd) return "-";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${d}/${m}/${y}`;
}

function addDays(dateStr, days) {
  const d = utcDateFromYMD(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return ymdFromUTCDate(d);
}

function getWeekStartMonday(ymd) {
  const d = utcDateFromYMD(ymd);
  const day = d.getUTCDay(); // 0 Sun..6 Sat
  const diff = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return ymdFromUTCDate(d);
}

function followupPlan(assigned, deadline) {
  if (!assigned || !deadline) return null;
  const a = new Date(assigned + "T00:00:00").getTime();
  const dl = new Date(deadline + "T00:00:00").getTime();
  const totalDays = Math.max(1, Math.round((dl - a) / 86400000));
  const f1 = addDays(assigned, Math.max(1, Math.round(totalDays * 0.33)));
  const f2 = addDays(assigned, Math.max(1, Math.round(totalDays * 0.66)));
  const f3 = addDays(assigned, Math.max(1, Math.round(totalDays * 0.9)));
  return [f1, f2, f3].map((x) => (new Date(x) >= new Date(deadline) ? addDays(deadline, -1) : x));
}

// group sort: active -> pending -> confirmed (confirmed tail)
// ✅ earliest→latest / latest→earliest อ้างอิง "deadline" เท่านั้น
// ✅ รองรับ deadline ได้หลายรูปแบบ แต่ยังคงใช้ "deadline" อย่างเดียวในการเรียง
// ✅ ถ้า deadline ไม่ถูกต้อง -> ไปท้ายเสมอ
// ✅ ถ้า deadline เท่ากัน -> tie-break ด้วย id (กันสลับมั่ว)
// group sort: active -> pending -> confirmed (confirmed tail)
// ✅ earliest→latest / latest→earliest อ้างอิง "deadline" เท่านั้น และเรียงทั้งชุดตาม deadline จริง (ไม่แบ่งกลุ่มก่อน)
// ✅ รองรับ deadline ได้หลายรูปแบบ (YYYY-MM-DD, YYYY-MM-DDTHH:mm, DD/MM/YYYY)
// ✅ ถ้า deadline ไม่ถูกต้อง -> ไปท้ายเสมอ
// ✅ ถ้า deadline เท่ากัน -> tie-break ด้วย id เพื่อให้ stable
function sortWithGroups(list, sortAsc) {
  const deadlineToKey = (v) => {
    const s = String(v || "").trim();
    if (!s) return null;

    // YYYY-MM-DD or YYYY-MM-DDTHH:mm (ignore time)
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (Number.isFinite(y) && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return y * 10000 + mo * 100 + d;
    }

    // DD/MM/YYYY
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) {
      const d = Number(m[1]);
      const mo = Number(m[2]);
      const y = Number(m[3]);
      if (Number.isFinite(y) && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return y * 10000 + mo * 100 + d;
    }

    // fallback: Date.parse
    const ts = Date.parse(s);
    if (Number.isFinite(ts)) {
      const dt = new Date(ts);
      return dt.getFullYear() * 10000 + (dt.getMonth() + 1) * 100 + dt.getDate();
    }
    return null;
  };

  const cmp = (a, b) => {
    const ad = deadlineToKey(a?.deadline);
    const bd = deadlineToKey(b?.deadline);
    const aValid = ad !== null;
    const bValid = bd !== null;

    // invalid -> tail
    if (!aValid && !bValid) {
      const ai = String(a?.id || "");
      const bi = String(b?.id || "");
      return ai.localeCompare(bi);
    }
    if (!aValid && bValid) return 1;
    if (aValid && !bValid) return -1;

    if (ad !== bd) return sortAsc ? ad - bd : bd - ad;

    const ai = String(a?.id || "");
    const bi = String(b?.id || "");
    return ai.localeCompare(bi);
  };

  // ✅ Pending should ALWAYS stay below "active" tasks, and should NOT be affected by the active sort toggle.
  // So we sort pending with a fixed earliest→latest order (by deadline) regardless of sortAsc.
  const cmpAsc = (a, b) => {
    const ad = deadlineToKey(a?.deadline);
    const bd = deadlineToKey(b?.deadline);
    const aValid = ad !== null;
    const bValid = bd !== null;

    if (!aValid && !bValid) {
      const ai = String(a?.id || "");
      const bi = String(b?.id || "");
      return ai.localeCompare(bi);
    }
    if (!aValid && bValid) return 1;
    if (aValid && !bValid) return -1;

    if (ad !== bd) return ad - bd;

    const ai = String(a?.id || "");
    const bi = String(b?.id || "");
    return ai.localeCompare(bi);
  };

  const arr = Array.isArray(list) ? [...list] : [];

  // ✅ Group order: ACTIVE -> PENDING -> CONFIRMED
  const confirmed = arr.filter((t) => t?.confirmed);
  const pending = arr.filter((t) => !t?.confirmed && Boolean(t?.result_submitted));
  const active = arr.filter((t) => !t?.confirmed && !Boolean(t?.result_submitted));

  // active follows the toggle
  active.sort(cmp);
  // pending is fixed order (not mixed with active)
  pending.sort(cmpAsc);
  // confirmed stays at the very bottom; keep it stable and readable
  confirmed.sort(cmpAsc);

  return [...active, ...pending, ...confirmed];
}




function AutoGrowTextarea({ value, onChange, placeholder, style, disabled }) {
  const ref = useRef(null);
  function onInput(e) {
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    onChange?.(e);
  }
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onInput}
      placeholder={placeholder}
      disabled={disabled}
      rows={1}
      style={{ ...style, resize: "none", overflow: "hidden" }}
    />
  );
}

export default function TaskBoard({ tasks = [], addTask, updateTask }) {
  const GlobalCSS = (
    <style>{`
      input[type="date"], input[type="datetime-local"] { color-scheme: dark; }
      input[type="date"]::-webkit-calendar-picker-indicator,
      input[type="datetime-local"]::-webkit-calendar-picker-indicator {
        -webkit-filter: invert(1) brightness(2);
        filter: invert(1) brightness(2);
        opacity: 1;
        cursor: pointer;
      }
      .sdwf-wrap { overflow-wrap:anywhere; word-break:break-word; white-space:normal; }
      * { box-sizing: border-box; }
    `}</style>
  );

  const [viewPerson, setViewPerson] = useState(() => parseJSON(LS_TASKBOARD_VIEW, null) || getSessionUser() || "meen");

  useEffect(() => setJSON(LS_TASKBOARD_VIEW, viewPerson), [viewPerson]);

  const [sortFollowupAsc, setSortFollowupAsc] = useState(true);
  const [sortRoutineAsc, setSortRoutineAsc] = useState(true);
  const [sortAddonAsc, setSortAddonAsc] = useState(true);

  const currentUser = viewPerson;
  const isOverview = currentUser === "all";
  const isSupervisor = SUPERVISORS.includes(currentUser);

  const isNamtip = currentUser === "namtip";
  const showAddButton = isSupervisor || isNamtip;

  // ✅ hide archived tasks everywhere (used by "Clear confirmed")
  const tasksLive = useMemo(() => (Array.isArray(tasks) ? tasks.filter((t) => !t.archived) : []), [tasks]);

  // ✅ Clear confirmed (archive) UI
  const [showClearConfirmed, setShowClearConfirmed] = useState(false);
  const [clearFromMonth, setClearFromMonth] = useState(""); // YYYY-MM
  const [clearToMonth, setClearToMonth] = useState("");     // YYYY-MM
  const [clearStep2, setClearStep2] = useState(false);

  const [minPending, setMinPending] = useState(false);
  const [minFollowup, setMinFollowup] = useState(false);
  const [minRoutine, setMinRoutine] = useState(false);
  const [minAddon, setMinAddon] = useState(false);

  const [expandedCard, setExpandedCard] = useState({});

  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({
    assigned_date: "",
    bu: "BU1",
    project: "DC",
    task: "",
    type: "routine",
    doer: "meen",
    support: "-",
    status: "not started",
    deadline: "",
  });

  // ✅ NEW (added only): popup controls
  const [minProfile, setMinProfile] = useState(false);
  const [minRemarks, setMinRemarks] = useState(false);

  // --- LEAVE REQUESTS: read from localStorage + keep in state ---
  const [leaveRequests, setLeaveRequests] = useState(() => parseJSON(LS_LEAVE_REQUESTS, []));
  useEffect(() => {
    const id = setInterval(() => setLeaveRequests(parseJSON(LS_LEAVE_REQUESTS, [])), 800);
    return () => clearInterval(id);
  }, []);

  const pendingLeaveForFah = useMemo(() => {
    if (currentUser !== "fah") return [];
    return (leaveRequests || []).filter((r) => r.type === "leave" && r.status === "pending" && r.notify_to === "fah");
  }, [leaveRequests, currentUser]);

  function confirmLeaveRequest(reqId) {
    const list = parseJSON(LS_LEAVE_REQUESTS, []);
    const idx = list.findIndex((r) => r.id === reqId);
    if (idx < 0) return alert("หา leave request ไม่เจอ");

    const req = list[idx];
    list[idx] = { ...req, status: "confirmed", confirmed_at: new Date().toISOString(), confirmed_by: currentUser };
    setJSON(LS_LEAVE_REQUESTS, list);
    setLeaveRequests(list);

    // also patch weekly plan day note to confirmed (so Worklog shows confirmed)
    const planStore = parseJSON(LS_WEEKLY_PLAN, {});
    const weekStart = getWeekStartMonday(req.requested_for_day || req.from_date);
    const planKey = `${req.user}__${weekStart}`;
    const plan = planStore?.[planKey];
    if (plan?.days?.[req.requested_for_day]) {
      planStore[planKey] = {
        ...plan,
        days: {
          ...plan.days,
          [req.requested_for_day]: {
            ...plan.days[req.requested_for_day],
            note: "confirmed",
            leave_req_id: req.id,
            type: "leave",
          },
        },
      };
      setJSON(LS_WEEKLY_PLAN, planStore);
    }

    alert("ยืนยันคำขอลากิจแล้ว ✅");
  }

  // ✅ helpers for clear-confirmed (deadline key + month range)
  function deadlineToKey(v) {
    const s = String(v || "").trim();
    if (!s) return null;

    // YYYY-MM-DD or YYYY-MM-DDTHH:mm (ignore time)
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (Number.isFinite(y) && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return y * 10000 + mo * 100 + d;
    }

    // DD/MM/YYYY
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) {
      const d = Number(m[1]);
      const mo = Number(m[2]);
      const y = Number(m[3]);
      if (Number.isFinite(y) && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return y * 10000 + mo * 100 + d;
    }

    const ts = Date.parse(s);
    if (Number.isFinite(ts)) {
      const dt = new Date(ts);
      return dt.getFullYear() * 10000 + (dt.getMonth() + 1) * 100 + dt.getDate();
    }
    return null;
  }

  function monthToStartEnd(monthStr) {
    const s = String(monthStr || "").trim(); // YYYY-MM
    const m = /^(\d{4})-(\d{2})$/.exec(s);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (!Number.isFinite(y) || mo < 1 || mo > 12) return null;

    // start = YYYYMM01
    const start = y * 10000 + mo * 100 + 1;

    // end day: last day of month
    const lastDay = new Date(y, mo, 0).getDate(); // JS month: mo is 1..12; Date(y,mo,0) gives last of prev month => correct
    const end = y * 10000 + mo * 100 + lastDay;

    return { start, end };
  }

  const clearCandidates = useMemo(() => {
    if (!isSupervisor) return [];
    const from = monthToStartEnd(clearFromMonth);
    const to = monthToStartEnd(clearToMonth);
    if (!from || !to) return [];

    // compare by YYYYMMDD
    const start = Math.min(from.start, to.start);
    const end = Math.max(from.end, to.end);

    return tasksLive.filter((t) => {
      if (!t.confirmed) return false;
      const k = deadlineToKey(t.deadline);
      if (k === null) return false;
      return k >= start && k <= end;
    });
  }, [tasksLive, isSupervisor, clearFromMonth, clearToMonth]);

  function archiveConfirmedInRange() {
    if (!isSupervisor) return alert("เฉพาะ Supervisor");
    const from = monthToStartEnd(clearFromMonth);
    const to = monthToStartEnd(clearToMonth);
    if (!from || !to) return alert("เลือกช่วงเดือน/ปี ให้ครบ");
    if (clearCandidates.length === 0) return alert("ไม่มี confirmed task ในช่วงเวลานี้");

    if (!clearStep2) {
      setClearStep2(true);
      return alert(`จะลบ (ซ่อน) confirmed ทั้งหมด ${clearCandidates.length} งาน
กด Confirm อีกครั้งเพื่อยืนยัน`);
    }

    // 2nd confirm
    const now = new Date().toISOString();
    for (const t of clearCandidates) {
      patchTask(t.id, { archived: true, archived_at: now, archived_by: currentUser });
    }

    setClearStep2(false);
    setShowClearConfirmed(false);
    setClearFromMonth("");
    setClearToMonth("");
    alert("ลบ (ซ่อน) confirmed ในช่วงเวลาที่เลือกแล้ว ✅");
  }

  // --- helpers ---
  const patchTask = (id, patch) => {
    if (typeof updateTask !== "function") return alert("updateTask ไม่ถูกส่งมา");
    updateTask(id, patch);
  };
  const createTaskToStore = (t) => {
    if (typeof addTask !== "function") return alert("addTask ไม่ถูกส่งมา");
    addTask(t);
  };

  function setWorkAt(taskId, newDT) {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    if (t.confirmed) return alert("งานนี้ complete แล้ว แก้ไม่ได้");
    const canSet = t.doer === currentUser || t.support === currentUser;
    if (!canSet) return alert("กำหนดวันทำงานได้เฉพาะ Doer หรือ Support");

    const old = t.work_at || "";
    if (old === newDT) return;

    const now = new Date().toISOString();
    const nextHistory = Array.isArray(t.work_at_history) ? [...t.work_at_history] : [];
    nextHistory.unshift({ from: old || "-", to: newDT || "-", at: now, by: currentUser });

    patchTask(taskId, { work_at: newDT, work_at_history: nextHistory });
  }

  function changeStatus(taskId, nextStatus, role) {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    if (t.confirmed) return alert("งานนี้ complete แล้ว แก้ไม่ได้");
    if (role !== "D") return alert("Support เปลี่ยนสถานะไม่ได้");

    if (nextStatus === "done") patchTask(taskId, { status: "done", confirmed: false });
    else patchTask(taskId, { status: nextStatus, result: "", result_submitted: false, result_editing: false, confirmed: false });
  }

  function submitResult(taskId, role) {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    if (t.confirmed) return alert("งานนี้ complete แล้ว");
    if (role !== "D") return alert("Support ส่งผลลัพธ์ไม่ได้");
    if (!t.result?.trim()) return alert("กรอกผลลัพธ์ก่อน");
    patchTask(taskId, { result_submitted: true, result_editing: false });
    setExpandedCard((prev) => ({ ...prev, [taskId]: false }));
  }

  function confirmDone(taskId) {
    if (!isSupervisor) return alert("เฉพาะ Supervisor");
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    if (t.created_by !== currentUser) return alert("คุณไม่ใช่ Supervisor เจ้าของงานนี้");
    if (t.status !== "done") return alert("ยังไม่ done");
    if (!t.result?.trim()) return alert("ยังไม่มี result");

    patchTask(taskId, { confirmed: true, followup_done: [true, true, true], result_submitted: true, result_editing: false });
    setExpandedCard((prev) => ({ ...prev, [taskId]: false }));
  }

  function toggleFollowup(taskId, idx) {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    if (!isSupervisor) return;
    if (t.created_by !== currentUser) return alert("ติดตามได้เฉพาะ Supervisor เจ้าของงาน");
    if (t.confirmed) return;

    const arr = Array.isArray(t.followup_done) ? [...t.followup_done] : [false, false, false];
    arr[idx] = !arr[idx];
    patchTask(taskId, { followup_done: arr });
  }

  function handleCreateTask() {
    if (!isSupervisor) {
      if (isNamtip) return alert("namtip จะเพิ่ม task ได้ในเงื่อนไขพิเศษ (ยังไม่เปิดใช้)");
      return;
    }
    if (!draft.assigned_date) return alert("เลือก date");
    if (!draft.task.trim()) return alert("กรอก task");
    if (!draft.deadline) return alert("เลือก Deadline");

    const t = {
      id: newId(),
      created_by: currentUser,
      assigned_date: draft.assigned_date,
      bu: draft.bu,
      project: draft.project,
      task: draft.task.trim(),
      type: draft.type,
      doer: draft.doer,
      support: draft.support || "-",
      status: draft.status,
      deadline: draft.deadline,
      work_at: "",
      work_at_history: [],
      result: "",
      result_submitted: false,
      result_editing: false,
      confirmed: false,
      followup_done: [false, false, false],
    };
    createTaskToStore(t);
    setDraft({ ...draft, task: "", deadline: "", assigned_date: "" });
    setShowAdd(false);
  }

  // selectors
  const myPendingConfirm = useMemo(() => {
    if (!isSupervisor) return [];
    return tasksLive.filter((t) => t.created_by === currentUser && t.status === "done" && t.result?.trim() && !t.confirmed);
  }, [tasks, currentUser, isSupervisor]);

  const myAssigned = useMemo(() => {
    if (!isSupervisor) return [];
    const list = tasksLive.filter((t) => t.created_by === currentUser);
    return sortWithGroups(list, sortFollowupAsc);
  }, [tasks, currentUser, isSupervisor, sortFollowupAsc]);

  const myTasks = useMemo(() => {
    if (isOverview) return [];
    return tasksLive.filter((t) => t.doer === currentUser || t.support === currentUser);
  }, [tasks, currentUser, isOverview]);

  const myRoutine = useMemo(() => sortWithGroups(myTasks.filter((t) => t.type === "routine"), sortRoutineAsc), [myTasks, sortRoutineAsc]);
  const myAddon = useMemo(() => sortWithGroups(myTasks.filter((t) => t.type === "add-on"), sortAddonAsc), [myTasks, sortAddonAsc]);

  const doerLoad = useMemo(() => {
    const load = {};
    for (const p of PEOPLE) load[p] = 0;
    for (const t of tasksLive) if (t.status !== "done" && t.doer) load[t.doer] = (load[t.doer] || 0) + 1;
    return load;
  }, [tasks]);

  const sortLabel = (asc) => (asc ? "earliest→latest" : "latest→earliest");

  // ✅ NEW (added only): progress bar data
  const myProgress = useMemo(() => {
    if (isOverview) return null;
    const mineDoer = tasksLive.filter((t) => t.doer === currentUser);
    const total = mineDoer.length || 0;
    const done = mineDoer.filter((t) => t.status === "done" && t.result?.trim() && t.confirmed).length;
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);
    return { total, done, percent };
  }, [tasks, currentUser, isOverview]);

  // ✅ NEW (added only): popup remarks data (doer+support)
  const myWorkAtHistory = useMemo(() => {
    if (isOverview) return [];
    const related = tasksLive.filter((t) => t.doer === currentUser || t.support === currentUser);
    const events = related.flatMap((t) => (t.work_at_history || []).map((h) => ({ task: t.task, ...h })));
    return events.slice(0, 30);
  }, [tasks, currentUser, isOverview]);

  const profileRole = isSupervisor ? "Supervisor" : "Team";

  // ✅ Profile popup: read Worklog data + compute weekly stats, yearly leave, badges & stars (weekly refresh)
  const WORKLOG_KEYS = {
    LOGS: ["sdwf_worklog_logs_v3", "sdwf_worklog_logs_v2"],
    WEEKLY_PLAN: ["sdwf_weekly_plan_v3", "sdwf_weekly_plan_v2"],
    LEAVES: ["sdwf_leave_requests_v2", "sdwf_leave_requests_v1"],
  };

  function readFirstLS(keys, fallback) {
    for (const k of keys) {
      const v = parseJSON(k, null);
      if (v !== null && v !== undefined) return v;
    }
    return fallback;
  }

  function ymd(d) {
  return ymdFromDateInTZ(d);
}

  function addDaysYMD(ymdStr, n) {
  const d = utcDateFromYMD(ymdStr);
  d.setUTCDate(d.getUTCDate() + n);
  return ymdFromUTCDate(d);
}

  function minutesFromISO(iso) {
    if (!iso) return null;
    const hh = Number(String(iso).slice(11, 13));
    const mm = Number(String(iso).slice(14, 16));
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return hh * 60 + mm;
  }

  function minutesBetweenHHMM(a, b) {
    if (!a || !b) return null;
    const [ah, am] = String(a).split(":").map(Number);
    const [bh, bm] = String(b).split(":").map(Number);
    if (![ah, am, bh, bm].every(Number.isFinite)) return null;
    return (bh * 60 + bm) - (ah * 60 + am);
  }

  const ROLE_TITLE = {
    meen: "Project Manager",
    art: "Coordinator (HR/Admin)",
    yung: "Facilitator / Coach",
    boy: "Content Creator",
    namtip: "General Manager (BU2)",
    tong: "Teacher (BU2)",
    fah: "COO",
    pluem: "CEO",
  };

  const worklogData = useMemo(() => {
    if (isOverview) return null;

    const logs = readFirstLS(WORKLOG_KEYS.LOGS, []);
    const plans = readFirstLS(WORKLOG_KEYS.WEEKLY_PLAN, {});
    const leaves = readFirstLS(WORKLOG_KEYS.LEAVES, []);

    const today = new Date();
    const todayYMD = ymd(today);
    const weekStart = getWeekStartMonday(todayYMD);
    const weekDays = Array.from({ length: 7 }, (_, i) => addDaysYMD(weekStart, i));

    const userLogs = Array.isArray(logs) ? logs.filter((x) => x?.user === currentUser && weekDays.includes(x?.date)) : [];
    const keyThisWeek = `${currentUser}__${weekStart}`;
    const weekPlan = plans?.[keyThisWeek]?.days || {};

    // weekly attendance stats
    let clockInDays = 0;
    let clockOutDays = 0;
    let missedOut = 0;
    let lateCount = 0;

    for (const d of weekDays) {
      const log = userLogs.find((x) => x?.date === d);
      if (log?.clock_in) clockInDays += 1;
      if (log?.clock_out) clockOutDays += 1;
      if (log?.clock_in && !log?.clock_out) missedOut += 1;

      // late check (only if plan says work and has start)
      const plan = weekPlan?.[d];
      if (plan?.type === "work" && plan?.start && log?.clock_in) {
        const planned = minutesBetweenHHMM("00:00", plan.start);
        const actual = minutesFromISO(log.clock_in);
        if (planned !== null && actual !== null && actual - planned > 5) lateCount += 1;
      }
    }

    // yearly leave stats (count leave requests in current year)
    const year = today.getFullYear();
    const userLeaves = Array.isArray(leaves) ? leaves.filter((x) => x?.user === currentUser) : [];
    const leavesThisYear = userLeaves.filter((x) => String(x?.from_date || "").startsWith(String(year)));
    const sickDays = leavesThisYear.filter((x) => x?.type === "sick").length;
    const leaveDays = leavesThisYear.filter((x) => x?.type === "leave").length;

    // weekly badge from Tasks + Worklog
    // 기준: 지난주 (weekStart - 7) ~ (weekStart - 1)
    const lastWeekStart = addDaysYMD(weekStart, -7);
    const lastWeekDays = Array.from({ length: 7 }, (_, i) => addDaysYMD(lastWeekStart, i));
    const inLastWeek = (t) => {
      const dl = String(t?.deadline || "").slice(0, 10);
      return lastWeekDays.includes(dl);
    };

    const confirmedDoneAsDoer = tasksLive.filter((t) => t?.confirmed && t?.doer === currentUser && inLastWeek(t)).length;
    const confirmedDoneAsSupport = tasksLive.filter((t) => t?.confirmed && t?.support === currentUser && inLastWeek(t)).length;

    const activeLoad = tasksLive.filter((t) => !t?.confirmed && t?.status !== "done" && (t?.doer === currentUser || t?.support === currentUser)).length;

    // badges
    const badges = [];
    let stars = 0;

    if (confirmedDoneAsDoer >= 5) { badges.push("นักเคลียร์งานยอดเยี่ยม"); stars += 5; }
    else if (confirmedDoneAsDoer >= 3) { badges.push("นักเคลียร์งานดีเด่น"); stars += 3; }

    if (confirmedDoneAsSupport >= 4) { badges.push("นัก support คนเก่ง"); stars += 4; }
    else if (confirmedDoneAsSupport >= 2) { badges.push("นัก support สุดปัง"); stars += 2; }

    if (lateCount === 0 && clockInDays >= 3) { badges.push("นักเข้างานสุดตรงเวลา"); stars += 3; }

    if (activeLoad >= 8) { badges.push("เดอะแบก"); stars += 4; }

    if (badges.length === 0) { badges.push("กำลังไต่เลเวล"); stars += 1; }

    // weekly cache at Monday 06:00 (local)
    const now = new Date();
    const isMonday = now.getDay() === 1;
    const afterSix = now.getHours() >= 6;
    const weekCacheKey = `sdwf_badges_week_${weekStart}`;
    const cached = parseJSON(weekCacheKey, null);

    const computed = {
      weekStart,
      weekDays,
      clockInDays,
      clockOutDays,
      missedOut,
      lateCount,
      year,
      sickDays,
      leaveDays,
      confirmedDoneAsDoer,
      confirmedDoneAsSupport,
      activeLoad,
      badges,
      stars,
      roleTitle: ROLE_TITLE[currentUser] || "Team",
    };

    // store once per week after Monday 06:00
    if (isMonday && afterSix && !cached) {
      setJSON(weekCacheKey, { ...computed, generated_at: now.toISOString() });
    }

    return computed;
  }, [isOverview, currentUser, tasksLive]);

  // Monthly recap popup (show once per month after 06:00 on day 1)
  useEffect(() => {
    if (isOverview) return;
    const now = new Date();
    if (now.getDate() !== 1 || now.getHours() < 6) return;

    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const seenKey = `sdwf_monthly_recap_seen_${ym}`;
    if (parseJSON(seenKey, false)) return;

    // simple recap: who cleared most confirmed tasks in last month (by deadline month)
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const monthPrefix = `${year}-${String(month).padStart(2, "0")}-`;
    const confirmedInMonth = tasksLive.filter((t) => t?.confirmed && String(t?.deadline || "").startsWith(monthPrefix));

    const byDoer = {};
    const bySupport = {};
    for (const t of confirmedInMonth) {
      if (t?.doer) byDoer[t.doer] = (byDoer[t.doer] || 0) + 1;
      if (t?.support && t.support !== "-") bySupport[t.support] = (bySupport[t.support] || 0) + 1;
    }

    const top = (obj) => {
      const entries = Object.entries(obj);
      entries.sort((a, b) => b[1] - a[1]);
      return entries[0] ? `${entries[0][0]} (${entries[0][1]})` : "-";
    };

    const msg =
      `Monthly recap: ${ym}\n` +
      `Top clearer: ${top(byDoer)}\n` +
      `Top supporter: ${top(bySupport)}\n` +
      `\n(ระบบจะอัปเดตรางวัล/ดาวรายสัปดาห์ ทุกวันจันทร์ 06:00)`;

    alert(msg);
    setJSON(seenKey, true);
  }, [isOverview, tasksLive]);

  return (
    <section style={{ paddingBottom: 90 }}>
      {GlobalCSS}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Task Board</h3>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", opacity: 0.9 }}>
          {PEOPLE.map((p) => (
            <span key={p} style={{ padding: "2px 8px", border: "1px solid #2b2b2b", borderRadius: 999, fontSize: 12 }}>
              {p}: {doerLoad[p] || 0}
            </span>
          ))}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {showAddButton && (
            <button
              onClick={() => {
                if (isSupervisor) setShowAdd((v) => !v);
                else alert("namtip จะเพิ่ม task ได้ในเงื่อนไขพิเศษ (ยังไม่เปิดใช้)");
              }}
              style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #2b2b2b", cursor: "pointer", fontSize: 12, opacity: isSupervisor ? 1 : 0.6 }}
            >
              + Add Task
            </button>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ opacity: 0.8, fontSize: 12 }}>View:</span>
            <select value={viewPerson} onChange={(e) => setViewPerson(e.target.value)} style={{ padding: 6, fontSize: 12 }}>
              <option value="all">All (overview)</option>
              <option value="fah">fah (Supervisor)</option>
              <option value="pluem">pluem (Supervisor)</option>
              <optgroup label="Team">
                {PEOPLE.filter((p) => !["fah", "pluem"].includes(p)).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>
      
      {/* ✅ Clear confirmed (Supervisor) */}
      {isSupervisor && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <button
            onClick={() => {
              setShowClearConfirmed((v) => !v);
              setClearStep2(false);
            }}
            style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #2b2b2b", cursor: "pointer", fontSize: 12 }}
            title="ลบ (ซ่อน) confirmed ตามช่วงเวลา"
          >
          Clear confirmed
          </button>

          {showClearConfirmed && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, opacity: 0.85 }}>From</div>
              <input type="month" value={clearFromMonth} onChange={(e) => { setClearFromMonth(e.target.value); setClearStep2(false); }} style={{ padding: 6, borderRadius: 10 }} />
              <div style={{ fontSize: 12, opacity: 0.85 }}>To</div>
              <input type="month" value={clearToMonth} onChange={(e) => { setClearToMonth(e.target.value); setClearStep2(false); }} style={{ padding: 6, borderRadius: 10 }} />

              <button
                onClick={archiveConfirmedInRange}
                style={{
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid #2b2b2b",
                  cursor: "pointer",
                  fontSize: 12,
                  background: clearStep2 ? "#b91c1c" : undefined,
                  color: clearStep2 ? "white" : undefined,
                }}
                title="ต้องกดยืนยัน 2 ครั้ง"
              >
                {clearStep2 ? "CONFIRM delete" : `Preview (${clearCandidates.length})`}
              </button>

              <button
                onClick={() => { setShowClearConfirmed(false); setClearStep2(false); setClearFromMonth(""); setClearToMonth(""); }}
                style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #2b2b2b", cursor: "pointer", fontSize: 12, opacity: 0.9 }}
              >
                Close
              </button>
            </div>
          )}
        </div>
      )}
</div>

      {/* Add task */}
      {showAdd && isSupervisor && (
        <div style={{ border: "1px solid #2b2b2b", borderRadius: 14, padding: 10, marginBottom: 10, background: "#141a1f" }}>
          <div style={{ display: "grid", gridTemplateColumns: "140px 90px 100px 1fr 90px 90px 110px 110px 120px", gap: 8, alignItems: "end" }}>
            <Field label="date"><input type="date" value={draft.assigned_date} onChange={(e) => setDraft({ ...draft, assigned_date: e.target.value })} style={inpSmall} /></Field>
            <Field label="BU"><select value={draft.bu} onChange={(e) => setDraft({ ...draft, bu: e.target.value })} style={inpSmall}>{BU_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
            <Field label="project"><select value={draft.project} onChange={(e) => setDraft({ ...draft, project: e.target.value })} style={inpSmall}>{PROJECT_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
            <Field label="task"><AutoGrowTextarea value={draft.task} onChange={(e) => setDraft({ ...draft, task: e.target.value })} placeholder="พิมพ์ task" style={inpTaskArea} /></Field>
            <Field label="type"><select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })} style={inpSmall}>{TYPE_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
            <Field label="doer"><select value={draft.doer} onChange={(e) => setDraft({ ...draft, doer: e.target.value })} style={inpSmall}>{PEOPLE.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
            <Field label="support"><select value={draft.support} onChange={(e) => setDraft({ ...draft, support: e.target.value })} style={inpSmall}><option value="-">-</option>{PEOPLE.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
            <Field label="status"><select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} style={inpSmall}>{STATUS_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
            <Field label="deadline"><input type="date" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} style={inpSmall} /></Field>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setShowAdd(false)} style={btnTiny}>Cancel</button>
            <button onClick={handleCreateTask} style={btnTiny}>Create</button>
          </div>
        </div>
      )}
            {/* ✅ Overview (All) */}
      {isOverview && (
        <div style={{ border: "1px solid #2b2b2b", borderRadius: 14, overflow: "hidden", background: "#0f1418" }}>
          <div
            style={{
              padding: "8px 10px",
              background: "#141a1f",
              borderBottom: "1px solid #2b2b2b",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 12 }}>All (overview)</div>

            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => setSortRoutineAsc((v) => !v)}
                style={{ padding: "4px 8px", borderRadius: 10, cursor: "pointer", fontSize: 12 }}
                title="Sort by deadline"
              >
                {sortRoutineAsc ? "earliest→latest" : "latest→earliest"}
              </button>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
                tableLayout: "fixed", // สำคัญมาก
              }}
            >
              <thead style={{ background: "#141a1f" }}>
                <tr>
                  {[
                    "deadline",
                    "task",
                    "type",
                    "doer",
                    "support",
                    "status",
                    "work_at",
                    "pending",
                    "confirmed",
                    "created_by",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: 10,
                        borderBottom: "1px solid #2b2b2b",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {sortWithGroups([...tasksLive], sortRoutineAsc).map((t) => (
                  <tr key={t.id} className="sdwf-wrap">
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {formatDate(t.deadline)}
                    </td>

                    {/* ✅ task column — กว้างกว่าช่องอื่น */}
                    <td
                      style={{td,
                        width: 360,              // ⭐ จุดที่ปรับความกว้าง task (เดิม 240)
                        whiteSpace: "normal",     // ให้ตัดบรรทัด
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                      }}
                    >
                      {t.task}
                    </td>

                    <td style={{ ...td, whiteSpace: "nowrap" }}>{t.type}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{t.doer}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{t.support}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{t.status}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {t.work_at ? t.work_at.replace("T", " ").slice(0, 16) : "-"}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {t.result_submitted && !t.confirmed ? "pending" : "-"}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {t.confirmed ? "yes" : "-"}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {t.created_by}
                    </td>
                  </tr>
                ))}

                {tasksLive.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ padding: 12, opacity: 0.7 }}>
                      ยังไม่มีงาน
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}


      {/* Supervisor TOP */}
      {!isOverview && isSupervisor && (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, alignItems: "stretch", marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateRows: `${SUP_PENDING_MAX_H}px ${SUP_GAP}px ${SUP_FOLLOWUP_H}px`, height: SUP_TOP_H }}>
            <Panel title="Pending confirmations" minimized={minPending} onToggle={() => setMinPending((v) => !v)} headerTight>
              {!minPending && (
                <div style={{ maxHeight: SUP_PENDING_MAX_H - 44, overflowY: "auto", paddingRight: 4 }}>
                  {currentUser === "fah" && pendingLeaveForFah.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6, opacity: 0.9 }}>
                        Leave requests (from Worklog)
                      </div>

                      <div style={{ display: "grid", gap: 8 }}>
                        {pendingLeaveForFah.map((r) => (
                          <div key={r.id} className="sdwf-wrap" style={cardPending}>
                            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                              <div style={taskSmall}><b>leave request</b></div>
                              <div style={metaSmall}>user:{r.user} · day:{r.requested_for_day}</div>
                              <div style={{ marginLeft: "auto" }}>
                                <button onClick={() => confirmLeaveRequest(r.id)} style={btnSmall}>Confirm</button>
                              </div>
                            </div>
                            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.9 }}>
                              {r.from_date} {r.from_time} → {r.to_date} {r.to_time}
                            </div>
                            <div style={resultClamp2}>{r.reason}</div>
                          </div>
                        ))}
                      </div>

                      <div style={{ height: 8 }} />
                    </div>
                  )}

                  {myPendingConfirm.length === 0 ? (
                    <div style={{ opacity: 0.7, fontSize: 12 }}>ยังไม่มีงานให้ตรวจสอบ</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {myPendingConfirm.map((t) => (
                        <div key={t.id} className="sdwf-wrap" style={cardPending}>
                          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                            <div style={taskSmall}><b>{t.task}</b></div>
                            <div style={metaSmall}>doer:{t.doer} · dl:{formatDate(t.deadline)}</div>
                            <div style={{ marginLeft: "auto" }}>
                              <button onClick={() => confirmDone(t.id)} style={btnSmall}>Confirm</button>
                            </div>
                          </div>
                          <div style={resultClamp2}>{t.result}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Panel>

            <div />

            <Panel
              title={`Supervisor follow-up (${currentUser})`}
              minimized={minFollowup}
              onToggle={() => setMinFollowup((v) => !v)}
              headerTight
              rightActions={<button onClick={() => setSortFollowupAsc((v) => !v)} style={btnTiny}>{sortLabel(sortFollowupAsc)}</button>}
            >
              {!minFollowup && (
                <div style={{ height: SUP_FOLLOWUP_H - 44, overflowY: "auto", paddingRight: 4 }}>
                  {myAssigned.length === 0 ? (
                    <div style={{ opacity: 0.7, fontSize: 12 }}>ยังไม่มีงานที่คุณสั่ง</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {myAssigned.map((t) => {
                        const plan = followupPlan(t.assigned_date, t.deadline);
                        const isConfirmed = t.confirmed;
                        return (
                          <div
                            key={t.id}
                            className="sdwf-wrap"
                            style={{
                              ...cardCompact,
                              background: isConfirmed ? "#374151" : "#1f2937",
                              color: "white",
                              opacity: isConfirmed ? 0.9 : 1,
                            }}
                          >
                            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                              <div style={taskSmall}><b>{t.task}</b></div>
                              <div style={metaSmallDark}>{projectTag(t) || t.project} · {t.bu} · {t.type}</div>
                              <div style={{ marginLeft: "auto", fontSize: 12 }}>dl: <b>{formatDate(t.deadline)}</b></div>
                            </div>

                            <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                              <div style={{ fontSize: 12, opacity: 0.85 }}>Follow-up:</div>
                              {plan ? plan.map((d, idx) => (
                                <label key={idx} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, opacity: isConfirmed ? 0.55 : 1 }}>
                                  <input type="checkbox" checked={Boolean(t.followup_done?.[idx])} onChange={() => toggleFollowup(t.id, idx)} disabled={isConfirmed} />
                                  {formatDate(d)}
                                </label>
                              )) : <span style={{ opacity: 0.75, fontSize: 12 }}>ต้องมี assigned+deadline</span>}
                              {isConfirmed && <span style={{ marginLeft: "auto", fontWeight: 800, fontSize: 12 }}>confirmed</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </Panel>
          </div>

          <div style={{ height: SUP_TOP_H }}>
            <Panel title="Notifications" minimized={false} headerTight>
              <div style={{ height: SUP_TOP_H - 44, overflowY: "auto" }}>
                <div style={{ fontSize: 12, opacity: 0.75 }}>(placeholder)</div>
                <ul style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
                  <li>team เข้างานสาย</li>
                  <li>หมดวันแล้วลืม clock out</li>
                  <li>ศุกร์ 12:00 เตือนกรอกเวลาสัปดาห์หน้า</li>
                </ul>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* Routine / Add-on */}
      {!isOverview && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Panel title="Routine" minimized={minRoutine} onToggle={() => setMinRoutine((v) => !v)} headerTight rightActions={
            <button onClick={() => setSortRoutineAsc((v) => !v)} style={btnTiny}>{sortLabel(sortRoutineAsc)}</button>
          }>
            {!minRoutine && (
              <TaskList
                items={myRoutine}
                currentUser={currentUser}
                expandedCard={expandedCard}
                setExpandedCard={setExpandedCard}
                onSetWorkAt={setWorkAt}
                onChangeStatus={changeStatus}
                onChangeResult={(id, val) => patchTask(id, { result: val })}
                onSubmitResult={submitResult}
                onSetEditing={(id, v) => patchTask(id, { result_editing: v })}
              />
            )}
          </Panel>

          <Panel title="Add-on" minimized={minAddon} onToggle={() => setMinAddon((v) => !v)} headerTight rightActions={
            <button onClick={() => setSortAddonAsc((v) => !v)} style={btnTiny}>{sortLabel(sortAddonAsc)}</button>
          }>
            {!minAddon && (
              <TaskList
                items={myAddon}
                currentUser={currentUser}
                expandedCard={expandedCard}
                setExpandedCard={setExpandedCard}
                onSetWorkAt={setWorkAt}
                onChangeStatus={changeStatus}
                onChangeResult={(id, val) => patchTask(id, { result: val })}
                onSubmitResult={submitResult}
                onSetEditing={(id, v) => patchTask(id, { result_editing: v })}
              />
            )}
          </Panel>
        </div>
      )}

      {/* ✅ ADDED ONLY: Popup Profile + Remarks (bottom-right) */}
      {!isOverview && (
        <div style={popupStack}>
          <div style={popupCard}>
            <div style={popupHeader}>
              <strong style={{ fontSize: 12 }}>Profile</strong>
              <button onClick={() => setMinProfile((v) => !v)} style={btnTiny}>
                {minProfile ? "▸" : "▾"}
              </button>
            </div>
            {!minProfile && (
              <div style={{ padding: 10, fontSize: 12, maxHeight: 180, overflowY: "auto" }}>
                <div><b>{currentUser}</b> · {worklogData?.roleTitle || profileRole}</div>

                <div style={{ marginTop: 6, opacity: 0.9 }}>
                  <b>สัปดาห์นี้</b> · in:{worklogData?.clockInDays ?? 0} · out:{worklogData?.clockOutDays ?? 0} · late:{worklogData?.lateCount ?? 0} · missed out:{worklogData?.missedOut ?? 0}
                </div>

                <div style={{ marginTop: 6, opacity: 0.9 }}>
                  <b>วันลาทั้งปี</b> · sick:{worklogData?.sickDays ?? 0} · leave:{worklogData?.leaveDays ?? 0}
                </div>

                <div style={{ marginTop: 6, opacity: 0.9 }}>
                  <b>Badge (อัปเดตรายสัปดาห์)</b>
                  <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(worklogData?.badges || ["-"]).map((b, idx) => (
                      <span key={idx} style={{ padding: "2px 8px", border: "1px solid #2b2b2b", borderRadius: 999, fontSize: 12, opacity: 0.95 }}>
                        {b}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: 6, opacity: 0.9 }}>
                  <b>ดาวสะสม</b> · {worklogData?.stars ?? 0} ★
                </div>

                <div style={{ marginTop: 6, opacity: 0.7, fontSize: 11 }}>
                  * ระบบคำนวณใหม่ทุกวันจันทร์ 06:00 และมีสรุปผลรายเดือน (ขึ้นครั้งแรกของเดือน)
                </div>
              </div>

            )}
          </div>

          <div style={popupCard}>
            <div style={popupHeader}>
              <strong style={{ fontSize: 12 }}>Remarks</strong>
              <button onClick={() => setMinRemarks((v) => !v)} style={btnTiny}>
                {minRemarks ? "▸" : "▾"}
              </button>
            </div>
            {!minRemarks && (
              <div style={{ maxHeight: 200, overflowY: "auto", padding: 10 }}>
                <div style={{ opacity: 0.75, fontSize: 12, marginBottom: 8 }}>
                  work time changes: {myWorkAtHistory.length}
                </div>

                {myWorkAtHistory.length === 0 ? (
                  <div style={{ opacity: 0.7, fontSize: 12 }}>ยังไม่มีประวัติการเลื่อนวันทำงาน</div>
                ) : (
                  myWorkAtHistory.map((e, idx) => (
                    <div key={idx} className="sdwf-wrap" style={{ fontSize: 12, opacity: 0.9, marginBottom: 8 }}>
                      <div style={{ fontWeight: 700 }}>{e.task}</div>
                      <div style={{ opacity: 0.75 }}>{e.from} → {e.to}</div>
                      <div style={{ opacity: 0.55, fontSize: 11 }}>{e.at}{e.by ? ` · by:${e.by}` : ""}</div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ✅ ADDED ONLY: Progress bar full width bottom */}
      {!isOverview && myProgress && (
        <div style={progressBar}>
          <strong style={{ whiteSpace: "nowrap" }}>{currentUser} progress</strong>
          <div style={{ flex: 1, height: 10, borderRadius: 999, background: "#0f1418", border: "1px solid #2b2b2b" }}>
            <div style={{ width: `${myProgress.percent}%`, height: "100%", borderRadius: 999, background: "#4ade80" }} />
          </div>
          <div style={{ whiteSpace: "nowrap", opacity: 0.9 }}>
            {myProgress.done}/{myProgress.total} ({myProgress.percent}%)
          </div>
        </div>
      )}
    </section>
  );
}

function Panel({ title, minimized, onToggle, rightActions, children, headerTight }) {
  return (
    <div style={{ border: "1px solid #2b2b2b", borderRadius: 14, overflow: "hidden", background: "#0f1418", height: "100%" }}>
      <div style={{ padding: headerTight ? "6px 10px" : "10px", background: "#141a1f", borderBottom: "1px solid #2b2b2b", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 12 }}>{title}</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {rightActions}
          {onToggle && <button onClick={onToggle} style={btnSmall}>{minimized ? "▸" : "▾"}</button>}
        </div>
      </div>
      {!minimized && <div style={{ padding: 10 }}>{children}</div>}
    </div>
  );
}

function TaskList({ items, currentUser, expandedCard, setExpandedCard, onSetWorkAt, onChangeStatus, onChangeResult, onSubmitResult, onSetEditing }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {items.length === 0 ? (
        <div style={{ opacity: 0.7, fontSize: 12 }}>ไม่มีงาน</div>
      ) : (
        items.map((t) => {
          const role = t.doer === currentUser ? "D" : t.support === currentUser ? "S" : "-";
          const canEditStatus = role === "D" && !t.confirmed;
          const canEditWorkAt = (role === "D" || role === "S") && !t.confirmed;

          const pending = Boolean(t.result_submitted) && !t.confirmed;
          const editing = Boolean(t.result_editing);

          const isCollapsible = t.confirmed || pending;
          const isExpanded = !isCollapsible ? true : Boolean(expandedCard[t.id]);

          if (isCollapsible && !isExpanded) {
            const rightLabel = t.confirmed ? "complete" : "pending";
            return (
              <div
                key={t.id}
                className="sdwf-wrap"
                style={{
                  border: "1px solid #2b2b2b",
                  borderRadius: 12,
                  padding: 8,
                  background: t.confirmed ? "#374151" : "#4b5563",
                  color: "white",
                  cursor: "pointer",
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
                onClick={() => setExpandedCard((prev) => ({ ...prev, [t.id]: true }))}
              >
                <div style={{ fontWeight: 800, fontSize: 12, flex: 1 }}>{t.task}{projectTag(t) ? ` · ${projectTag(t)}` : ""}</div>

                {!t.confirmed && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetEditing(t.id, true);
                      setExpandedCard((prev) => ({ ...prev, [t.id]: true }));
                    }}
                    style={{ padding: "2px 8px", borderRadius: 10, fontSize: 11, cursor: "pointer" }}
                  >
                    edit
                  </button>
                )}

                <div style={{ fontSize: 12, opacity: 0.9 }}>{rightLabel}</div>
              </div>
            );
          }

          const bg = t.confirmed ? "#374151" : pending ? "#4b5563" : "#e5e7eb";
          const fg = t.confirmed || pending ? "white" : "#111827";

          return (
            <div key={t.id} className="sdwf-wrap" style={{ border: "1px solid #2b2b2b", borderRadius: 12, padding: 8, background: bg, color: fg }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 900, fontSize: 12 }}>{role}</div>
                <div style={{ fontSize: 12, opacity: 0.9 }}>dl: <b>{formatDate(t.deadline)}</b>{projectTag(t) ? ` · ${projectTag(t)}` : (t.project ? ` · ${t.project}` : "")}</div>

                <div style={{ display: "grid", gridTemplateColumns: "160px 140px", gap: 8 }}>
                  <input
                    type="datetime-local"
                    value={t.work_at || ""}
                    disabled={!canEditWorkAt}
                    onChange={(e) => onSetWorkAt(t.id, e.target.value)}
                    style={{ width: "100%", padding: 6, borderRadius: 10, border: "1px solid #2b2b2b", background: canEditWorkAt ? "#0f1418" : "#1a1f24", color: "white", fontSize: 12 }}
                  />
                  <select
                    value={t.status}
                    onChange={(e) => onChangeStatus(t.id, e.target.value, role)}
                    disabled={!canEditStatus}
                    style={{ width: "100%", padding: 6, borderRadius: 10, fontSize: 12 }}
                  >
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.95 }}>
                  {role === "S" ? `doer: ${t.doer}` : (t.support && t.support !== "-" ? `support: ${t.support}` : "")}
                </div>

                {isCollapsible && (
                  <button onClick={() => setExpandedCard((prev) => ({ ...prev, [t.id]: false }))} style={btnTiny}>
                    collapse
                  </button>
                )}
              </div>

              <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, lineHeight: 1.2 }}>{t.task}</div>

              <div style={{ marginTop: 6 }}>
                {t.status !== "done" ? (
                  <div style={{ opacity: 0.8, fontSize: 12 }}>result: -</div>
                ) : (
                  <div>
                    <textarea
                      value={t.result || ""}
                      onChange={(e) => onChangeResult(t.id, e.target.value)}
                      rows={2}
                      disabled={role !== "D" || t.confirmed || (pending && !editing)}
                      style={{ width: "100%", padding: 8, borderRadius: 10, background: pending ? "#f1f5f9" : "white", color: "#111827", opacity: pending && !editing ? 0.75 : 1 }}
                    />

                    <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
                      {!t.confirmed && role === "D" && (
                        <button onClick={() => onSubmitResult(t.id, role)} style={btnSmall} disabled={pending && !editing}>
                          Submit
                        </button>
                      )}
                      {!t.confirmed && pending && <span style={{ fontSize: 12, opacity: 0.9 }}>pending</span>}
                      {t.confirmed && <span style={{ fontSize: 12, fontWeight: 800, marginLeft: "auto" }}>complete</span>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const inpSmall = { width: "100%", padding: 6, borderRadius: 10, border: "1px solid #2b2b2b", background: "#0f1418", color: "white", fontSize: 12 };
const td = { padding: 10, borderBottom: "1px solid #2b2b2b", verticalAlign: "top" };

const inpTaskArea = { width: "100%", padding: 6, borderRadius: 10, border: "1px solid #2b2b2b", background: "#0f1418", color: "white", fontSize: 12, minHeight: 38 };

const btnSmall = { padding: "6px 10px", borderRadius: 10, cursor: "pointer", whiteSpace: "nowrap", fontSize: 12 };
const btnTiny = { padding: "4px 8px", borderRadius: 10, cursor: "pointer", fontSize: 12 };

// popup + progress styles (added)
const popupStack = {
  position: "fixed",
  right: 14,
  bottom: 76, // above progress bar
  width: 360,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  zIndex: 30,
};
const popupCard = {
  border: "1px solid #2b2b2b",
  borderRadius: 12,
  background: "#141a1f",
  overflow: "hidden",
};
const popupHeader = {
  padding: "8px 10px",
  borderBottom: "1px solid #2b2b2b",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};
const progressBar = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  borderTop: "1px solid #2b2b2b",
  background: "#141a1f",
  padding: "10px 16px",
  display: "flex",
  alignItems: "center",
  gap: 12,
  zIndex: 25,
};

const cardPending = { border: "1px solid #2b2b2b", borderRadius: 12, padding: "6px 8px" };
const cardCompact = { border: "1px solid #2b2b2b", borderRadius: 12, padding: 8 };

const taskSmall = { fontSize: 12, lineHeight: 1.2 };
const metaSmall = { fontSize: 12, opacity: 0.75 };
const metaSmallDark = { fontSize: 12, opacity: 0.8 };

const resultClamp2 = {
  marginTop: 4,
  fontSize: 12,
  opacity: 0.85,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};