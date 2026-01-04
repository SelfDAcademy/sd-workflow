import { useEffect, useMemo, useRef, useState } from "react";
import { useTasks } from "../TaskStore";

const PEOPLE = ["meen", "art", "yung", "boy", "namtip", "tong", "fah", "pluem"];
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

const LS_PASSCODES = "sdwf_passcodes_v3";
const LS_SESSION = "sdwf_worklog_session_v3";
const LS_WEEKLY_PLAN = "sdwf_weekly_plan_v3";
const LS_LOGS = "sdwf_worklog_logs_v3";
const LS_LEAVE_REQUESTS = "sdwf_leave_requests_v2";
const LS_REFLECTIONS = "sdwf_reflections_v1";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function localDOW(ymd) {
  return DOW[new Date(`${ymd}T00:00:00`).getDay()];
}
function getWeekStartMonday(ymd) {
  const d = new Date(`${ymd}T00:00:00`);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
function addDaysYMD(ymd, days) {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function minutesBetween(startHHMM, endHHMM) {
  if (!startHHMM || !endHHMM) return 0;
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  if ([sh, sm, eh, em].some((x) => Number.isNaN(x))) return 0;
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
}
function minutesFromISO(iso) {
  if (!iso) return null;
  const hh = Number(iso.slice(11, 13));
  const mm = Number(iso.slice(14, 16));
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}
function timeFromISO(iso) {
  return iso ? iso.slice(11, 16) : "-";
}
function safeId() {
  try {
    return crypto.randomUUID();
  } catch {
    return "id_" + Math.random().toString(36).slice(2, 9);
  }
}
function requirementWeekMinutes(user) {
  return USER_TYPE[user] === "full_time" ? 40 * 60 : 0;
}
function isFridayPlanningWindowNow() {
  const d = new Date();
  return d.getDay() === 5 && d.getHours() >= 12;
}
function makePlanKey(user, weekStartYMD) {
  return `${user}__${weekStartYMD}`;
}
function defaultDay(user, ymd) {
  const day = new Date(`${ymd}T00:00:00`).getDay();
  const isWeekend = day === 0 || day === 6;
  if (isWeekend) return { type: "off", start: "", end: "", note: "", day_tasks: [], leave_req_id: "" };
  const isPT = USER_TYPE[user] === "part_time";
  return { type: "work", start: isPT ? "13:00" : "09:00", end: isPT ? "18:00" : "18:00", note: "", day_tasks: [], leave_req_id: "" };
}
function ensurePasscodes() {
  const v = parseJSON(LS_PASSCODES, null);
  if (v && typeof v === "object") return v;
  const init = {};
  for (const p of PEOPLE) init[p] = "1234";
  setJSON(LS_PASSCODES, init);
  return init;
}
function ensureWeeklyPlanStore() {
  const v = parseJSON(LS_WEEKLY_PLAN, {});
  if (v && typeof v === "object") return v;
  setJSON(LS_WEEKLY_PLAN, {});
  return {};
}
function ensureLogsStore() {
  const v = parseJSON(LS_LOGS, []);
  if (Array.isArray(v)) return v;
  setJSON(LS_LOGS, []);
  return [];
}
function ensureLeaveRequests() {
  const v = parseJSON(LS_LEAVE_REQUESTS, []);
  if (Array.isArray(v)) return v;
  setJSON(LS_LEAVE_REQUESTS, []);
  return [];
}

function ensureReflections() {
  const v = parseJSON(LS_REFLECTIONS, {});
  if (v && typeof v === "object") return v;
  setJSON(LS_REFLECTIONS, {});
  return {};
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
          <button onClick={onClose} style={btnSm}>Close</button>
        </div>
        <div style={{ padding: 12 }}>{children}</div>
      </div>
    </div>
  );
}

export default function WorklogPage() {
  const { tasks } = useTasks();

  const [passcodes, setPasscodes] = useState(() => ensurePasscodes());
  const [weeklyPlanStore, setWeeklyPlanStore] = useState(() => ensureWeeklyPlanStore());
  const [logs, setLogs] = useState(() => ensureLogsStore());
  const [leaveRequests, setLeaveRequests] = useState(() => ensureLeaveRequests());

  const [reflectionsStore, setReflectionsStore] = useState(() => ensureReflections());

  // Reflection draft (today)
  const [refDraft, setRefDraft] = useState({ mood: "", text: "" });

  // Reflection viewer (mini calendar click)
  const [refViewDay, setRefViewDay] = useState("");
  const [refViewOpen, setRefViewOpen] = useState(false);

  const [selectedUser, setSelectedUser] = useState("meen");
  const [passInput, setPassInput] = useState("");
  const [sessionUser, setSessionUser] = useState(() => parseJSON(LS_SESSION, null)?.user || "");

  useEffect(() => setJSON(LS_PASSCODES, passcodes), [passcodes]);
  useEffect(() => setJSON(LS_WEEKLY_PLAN, weeklyPlanStore), [weeklyPlanStore]);
  useEffect(() => setJSON(LS_LOGS, logs), [logs]);
  useEffect(() => setJSON(LS_LEAVE_REQUESTS, leaveRequests), [leaveRequests]);

  const today = todayYMD();
  const todayDow = localDOW(today);

  const miniDays = useMemo(() => {
    const out = [];
    // last 7 days (day 7 = today)
    for (let i = 6; i >= 0; i--) out.push(addDaysYMD(today, -i));
    return out;
  }, [today]);

  const thisWeekStart = getWeekStartMonday(today);
  const nextWeekStart = addDaysYMD(thisWeekStart, 7);

  const [planMode, setPlanMode] = useState("this");
  const weekStart = planMode === "next" ? nextWeekStart : thisWeekStart;
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysYMD(weekStart, i)), [weekStart]);

  const planUser = sessionUser || selectedUser;

  // Sync reflection draft from store
  useEffect(() => {
    if (!planUser) return;
    const key = `${planUser}__${today}`;
    const item = reflectionsStore?.[key];
    setRefDraft({ mood: item?.mood || "", text: item?.text || "" });
  }, [planUser, today, reflectionsStore]);
const planKey = makePlanKey(planUser, weekStart);

  const currentPlan = useMemo(() => {
    const p = weeklyPlanStore?.[planKey];
    if (p && p.days) return p;
    const days = {};
    for (const d of weekDates) days[d] = defaultDay(planUser, d);
    return { locked: false, locked_at: "", days };
  }, [weeklyPlanStore, planKey, weekDates, planUser]);

  const [draftPlan, setDraftPlan] = useState(currentPlan);
  useEffect(() => setDraftPlan(currentPlan), [currentPlan]);

  const canEditNextWeek = isFridayPlanningWindowNow();
  const canEditPlan = useMemo(() => {
    if (!sessionUser) return false;
    if (draftPlan.locked) return false;
    if (planMode === "this") return true;
    return canEditNextWeek;
  }, [sessionUser, draftPlan.locked, planMode, canEditNextWeek]);

  const banner = useMemo(() => {
    if (!sessionUser || planMode !== "next") return "";
    if (draftPlan.locked) return "✅ สัปดาห์หน้าถูกยืนยันแล้ว";
    if (canEditNextWeek) return "⚠️ เปิดให้ลงสัปดาห์หน้าเฉพาะศุกร์ 12:00–23:59 (Save แล้วล็อก)";
    return "🔒 สัปดาห์หน้ายังแก้ไม่ได้";
  }, [sessionUser, planMode, canEditNextWeek, draftPlan.locked]);

  const totalWeekMinutes = useMemo(() => {
    const days = draftPlan.days || {};
    let sum = 0;
    for (const d of weekDates) {
      const day = days[d] || defaultDay(planUser, d);
      if (day.type === "work") sum += minutesBetween(day.start, day.end);
    }
    return sum;
  }, [draftPlan, weekDates, planUser]);

  const reqWeekMin = useMemo(() => (sessionUser ? requirementWeekMinutes(sessionUser) : 0), [sessionUser]);
  const totalHoursLabel = `${Math.round((totalWeekMinutes / 60) * 10) / 10} / ${reqWeekMin / 60} hrs`;

  const todayPlan = useMemo(() => {
    if (!sessionUser) return null;
    const key = makePlanKey(sessionUser, getWeekStartMonday(today));
    return weeklyPlanStore?.[key]?.days?.[today] || null;
  }, [weeklyPlanStore, sessionUser, today]);

  const todayLog = useMemo(() => {
    if (!sessionUser) return null;
    return logs.find((l) => l.user === sessionUser && l.date === today) || null;
  }, [logs, sessionUser, today]);

  const stats30 = useMemo(() => {
    if (!sessionUser) return { late: 0, missedOut: 0, absent: 0 };
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    let late = 0, missedOut = 0, absent = 0;

    for (const l of logs) {
      if (l.user !== sessionUser) continue;
      const d = new Date(`${l.date}T00:00:00`);
      if (d < cutoff) continue;

      const week = getWeekStartMonday(l.date);
      const pk = makePlanKey(sessionUser, week);
      const dayPlan = weeklyPlanStore?.[pk]?.days?.[l.date];

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
  }, [sessionUser, logs, weeklyPlanStore]);

  const [manageOpen, setManageOpen] = useState(false);
  const [manageDay, setManageDay] = useState("");

  const ongoingTasks = useMemo(() => {
    if (!sessionUser) return [];
    return tasks.filter((t) => (t.doer === sessionUser || t.support === sessionUser) && t.status !== "done");
  }, [tasks, sessionUser]);

  const [sickOpen, setSickOpen] = useState(false);
  const [sickForm, setSickForm] = useState({ from_date: today, from_time: "09:00", to_date: today, to_time: "18:00", reason: "" });

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveTargetDay, setLeaveTargetDay] = useState("");
  const [leaveForm, setLeaveForm] = useState({ from_date: "", from_time: "", to_date: "", to_time: "", reason: "" });

  function dayTaskNames(ymd) {
    const ids = draftPlan?.days?.[ymd]?.day_tasks || [];
    const titles = ids.map((id) => tasks.find((t) => t.id === id)?.task).filter(Boolean);
    return titles;
  }

  function unlock() {
    const correct = passcodes[selectedUser];
    if (!correct) return alert("ยังไม่มี passcode");
    if (passInput !== correct) return alert("รหัสผ่านไม่ถูกต้อง");
    setSessionUser(selectedUser);
    setJSON(LS_SESSION, { user: selectedUser, at: nowISO() });
    setPassInput("");
  }
  function logout() {
    setSessionUser("");
    setJSON(LS_SESSION, { user: "", at: nowISO() });
  }
  function setOrChangePasscode() {
    const user = selectedUser;
    const newPass = prompt(`ตั้ง passcode ใหม่สำหรับ ${user}`);
    if (!newPass) return;
    setPasscodes((prev) => ({ ...prev, [user]: String(newPass) }));
    alert("ตั้งรหัสสำเร็จ");
  }

  function ensureTodayRow() {
    if (!sessionUser) return null;
    const existing = logs.find((l) => l.user === sessionUser && l.date === today);
    if (existing) return existing;
    const row = { id: safeId(), user: sessionUser, date: today, clock_in: "", clock_out: "" };
    const next = [row, ...logs];
    setLogs(next);
    return row;
  }
  function clockIn() {
    if (!sessionUser) return alert("ต้องปลดล็อกก่อน");
    const row = ensureTodayRow();
    if (!row) return;
    if (row.clock_in) return alert("วันนี้ clock in แล้ว");
    const next = logs.map((l) => (l.id === row.id ? { ...l, clock_in: nowISO() } : l));
    setLogs(next);
  }
  function clockOut() {
    if (!sessionUser) return alert("ต้องปลดล็อกก่อน");
    const row = ensureTodayRow();
    if (!row) return;
    if (row.clock_in) return alert("ต้อง clock in ก่อน");
    if (row.clock_out) return alert("วันนี้ clock out แล้ว");
    const next = logs.map((l) => (l.id === row.id ? { ...l, clock_out: nowISO() } : l));
    setLogs(next);
  }

  function savePlan() {
    if (!sessionUser) return alert("ต้องปลดล็อกก่อน");
    if (!canEditPlan) return alert("ตอนนี้แก้ไขไม่ได้");
    if (USER_TYPE[sessionUser] === "full_time" && totalWeekMinutes < 40 * 60) {
      return alert(`ชั่วโมงทั้งสัปดาห์ยังไม่ถึง 40 ชั่วโมง (ตอนนี้ ${Math.round((totalWeekMinutes / 60) * 10) / 10} ชม.)`);
    }
    const store = { ...(weeklyPlanStore || {}) };
    store[planKey] = draftPlan;
    if (planMode === "next") store[planKey] = { ...draftPlan, locked: true, locked_at: nowISO() };
    setWeeklyPlanStore(store);
    alert("บันทึกแผนแล้ว");
  }

  function openManageTasks(ymd) {
    if (!sessionUser) return alert("ต้องปลดล็อกก่อน");
    setManageDay(ymd);
    setManageOpen(true);
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

  function submitBusinessLeave() {
    if (!sessionUser) return alert("ต้องปลดล็อกก่อน");
    if (!leaveForm.reason.trim()) return alert("กรุณาใส่เหตุผลลากิจ");
    const from = new Date(`${leaveForm.from_date}T00:00:00`);
    const now = new Date(`${today}T00:00:00`);
    const diffDays = Math.floor((from.getTime() - now.getTime()) / 86400000);
    if (diffDays < 3) return alert("ลากิจต้องล่วงหน้าอย่างน้อย 3 วัน");

    const req = { id: safeId(), user: sessionUser, type: "leave", status: "pending", created_at: nowISO(), requested_for_day: leaveTargetDay, ...leaveForm, notify_to: "fah" };
    setLeaveRequests((prev) => [req, ...prev]);

    const next = JSON.parse(JSON.stringify(draftPlan));
    next.days[leaveTargetDay] = { ...(next.days[leaveTargetDay] || defaultDay(sessionUser, leaveTargetDay)), type: "leave", leave_req_id: req.id, note: "pending", start: "", end: "" };
    setDraftPlan(next);

    setLeaveOpen(false);
    alert("ส่งคำขอลากิจแล้ว (pending)");
  }

  function submitSickLeave() {
    if (!sessionUser) return alert("ต้องปลดล็อกก่อน");
    if (!sickForm.reason.trim()) return alert("กรุณาใส่เหตุผล/อาการป่วย");
    const req = { id: safeId(), user: sessionUser, type: "sick", status: "logged", created_at: nowISO(), ...sickForm, notify_to: "fah" };
    setLeaveRequests((prev) => [req, ...prev]);
    setSickOpen(false);
    alert("บันทึกลาป่วยแล้ว");
  }

  // ✅ MAIN GRID: 2 columns only (removes reserved and widens plan table)
  return (
    <main style={{ padding: 16, height: "calc(100vh - 120px)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Worklog</h2>
        <div style={{ opacity: 0.7, fontSize: 12 }}>Clock + Weekly Plan</div>
        <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.8 }}>
          Session: <b>{sessionUser || "-"}</b>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "340px 1fr", gap: 12, height: "calc(100% - 52px)" }}>
        {/* LEFT column (login smaller + today + leave local) */}
        <div style={{ display: "grid", gridTemplateRows: "auto 1fr 1fr", gap: 12, minHeight: 0 }}>
          <Card title="Reflection (Today)" scroll>
            <div style={{ display: "grid", gap: 2 }}>
              <div style={{ fontSize: 12, opacity: 0.85 }}>
                owner: <b>{planUser}</b> · date: <b>{today}</b>
              </div>

              <Field label="Work Mood">
                <select
                  value={refDraft.mood}
                  onChange={(e) => setRefDraft((p) => ({ ...p, mood: e.target.value }))}
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
                  onChange={(e) => setRefDraft((p) => ({ ...p, text: e.target.value }))}
                  rows={2}
                  style={{ ...inpSmall, height: "auto" }}
                  placeholder="วันนี้เรียนรู้อะไรเกี่ยวกับการทำงานบ้าง? / อะไรที่ทำได้ดี / อะไรที่อยากปรับ"
                />
              </Field>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => {
                    if (!planUser) return alert("ยังไม่มี owner");
                    const key = `${planUser}__${today}`;
                    const next = { ...(reflectionsStore || {}) };
                    next[key] = { user: planUser, date: today, mood: refDraft.mood || "", text: refDraft.text || "", saved_at: nowISO() };
                    setReflectionsStore(next);
                    alert("Saved ✅");
                  }}
                  style={btnXs}
                >
                  Save
                </button>
              </div>

              <div style={{ borderTop: "1px solid #2b2b2b", paddingTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Mini calendar (last 14 days)</div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
                  {miniDays.map((d) => {
                    const k = `${planUser}__${d}`;
                    const item = reflectionsStore?.[k];
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
                        <div style={{ fontSize: 10, opacity: 0.75 }}>{d.slice(8, 10)}/{d.slice(5, 7)}</div>
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
                planned: <b>{todayPlan?.type === "work" ? `${todayPlan.start || "-"} → ${todayPlan.end || "-"}` : todayPlan?.type || "-"}</b>
              </div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>clock in: <b>{todayLog?.clock_in ? timeFromISO(todayLog.clock_in) : "-"}</b></div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>clock out: <b>{todayLog?.clock_out ? timeFromISO(todayLog.clock_out) : "-"}</b></div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={clockIn} style={btnXs}>In</button>
                <button onClick={clockOut} style={btnXs}>Out</button>
                <button onClick={() => setSickOpen(true)} style={btnWarnXs}>Sick</button>
              </div>
            </div>
          </Card>

          <Card title="Leave requests" scroll>
            {leaveRequests.filter((r) => r.user === (sessionUser || selectedUser)).length === 0 ? (
              <div style={{ fontSize: 12, opacity: 0.7 }}>ยังไม่มีคำขอ</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {leaveRequests
                  .filter((r) => r.user === (sessionUser || selectedUser))
                  .slice(0, 20)
                  .map((r) => (
                    <div key={r.id} style={{ border: "1px solid #2b2b2b", borderRadius: 10, padding: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 12 }}>{r.type} · {r.status}</div>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>
                        {r.from_date} {r.from_time} → {r.to_date} {r.to_time}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>{r.reason}</div>
                    </div>
                  ))}
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT column: top row (weekly plan + stats), bottom row plan table */}
        <div style={{ display: "grid", gridTemplateRows: "auto 1fr", gap: 12, minHeight: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
            <Card title="Weekly plan">
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 3 }}>{banner}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={() => setPlanMode("this")} style={planMode === "this" ? btnActive : btnXs}>This week</button>
                <button onClick={() => setPlanMode("next")} style={planMode === "next" ? btnActive : btnXs}>Next week</button>

                <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ fontSize: 12, opacity: 0.85 }}>total: <b>{totalHoursLabel}</b></div>
                  <button onClick={savePlan} style={btnXs} disabled={!canEditPlan}>Save</button>
                </div>

                <div style={{ width: "100%", fontSize: 12, opacity: 0.75 }}>
                  week start (Mon): <b>{weekStart}</b> · edit: <b>{canEditPlan ? "allowed" : "locked"}</b>
                </div>
              </div>
            </Card>

            <Card title="Stats (30 days)" scroll={false}>
              <div style={{ display: "grid", gap: 8, fontSize: 12, opacity: 0.9 }}>
                <div>late: <b>{stats30.late}</b></div>
                <div>missed out: <b>{stats30.missedOut}</b></div>
                <div>absence: <b>{stats30.absent}</b></div>
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

{/* start / end ต้องเห็นเลขชัด */}
<th style={{ ...thXs, width: "7.5%" }}>start</th>
<th style={{ ...thXs, width: "7.5%" }}>end</th>

<th style={{ ...thXs, width: "3.5%" }}>hrs</th>

{/* ⭐ tasks กว้างขึ้น */}
<th style={{ ...thXs, width: "38%" }}>tasks</th>

<th style={{ ...thXs, width: "6%" }}>manage</th>

{/* ⭐ note กว้างขึ้น */}
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
                          {leaveReq && <div style={{ marginTop: 2, fontSize: 12, opacity: 0.85 }}>{leaveReq.status}</div>}
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
                                <div key={i} style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.1 }}>{nm}</div>
                              ))}
                              {names.length > 3 && <div style={{ fontSize: 12, opacity: 0.75 }}>+{names.length - 3} more</div>}
                            </div>
                          )}
                        </td>

                        <td style={tdXs}>
                          <button style={btnXs} disabled={!sessionUser} onClick={() => { setManageDay(d); setManageOpen(true); }}>
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


      {/* Reflection detail popup (from mini calendar) */}
      {refViewOpen && (
        <Modal
          title={`Reflection: ${refViewDay} (${localDOW(refViewDay)})`}
          onClose={() => setRefViewOpen(false)}
        >
          {(() => {
            const key = `${planUser}__${refViewDay}`;
            const item = reflectionsStore?.[key];
            if (!item) {
              return <div style={{ fontSize: 12, opacity: 0.8 }}>ยังไม่มี reflection ของวันนี้</div>;
            }
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
                <div style={{ fontSize: 12, opacity: 0.6 }}>
                  saved: {item.saved_at ? timeFromISO(item.saved_at) : "-"}
                </div>
              </div>
            );
          })()}
        </Modal>
      )}

      {/* Manage tasks modal */}
      {manageOpen && sessionUser && (
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
                      <div style={{ opacity: 0.75 }}>{t.type} · dl {t.deadline}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            <button onClick={() => setManageOpen(false)} style={btnSm}>Close</button>
          </div>
        </Modal>
      )}

      {/* Sick leave modal */}
      {sickOpen && sessionUser && (
        <Modal title="Sick leave" onClose={() => setSickOpen(false)}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="from date"><input type="date" value={sickForm.from_date} onChange={(e) => setSickForm({ ...sickForm, from_date: e.target.value })} style={inp} /></Field>
              <Field label="from time"><input type="time" value={sickForm.from_time} onChange={(e) => setSickForm({ ...sickForm, from_time: e.target.value })} style={inp} /></Field>
              <Field label="to date"><input type="date" value={sickForm.to_date} onChange={(e) => setSickForm({ ...sickForm, to_date: e.target.value })} style={inp} /></Field>
              <Field label="to time"><input type="time" value={sickForm.to_time} onChange={(e) => setSickForm({ ...sickForm, to_time: e.target.value })} style={inp} /></Field>
            </div>
            <Field label="reason (symptoms)">
              <textarea value={sickForm.reason} onChange={(e) => setSickForm({ ...sickForm, reason: e.target.value })} rows={3} style={{ ...inp, width: "100%" }} />
            </Field>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setSickOpen(false)} style={btnSm}>Cancel</button>
              <button onClick={() => {
                if (!sessionUser) return alert("ต้องปลดล็อกก่อน");
                if (!sickForm.reason.trim()) return alert("กรุณาใส่เหตุผล/อาการป่วย");
                const req = { id: safeId(), user: sessionUser, type: "sick", status: "logged", created_at: nowISO(), ...sickForm, notify_to: "fah" };
                setLeaveRequests((prev) => [req, ...prev]);
                setSickOpen(false);
              }} style={btnWarnSm}>Submit</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Leave request modal */}
      {leaveOpen && sessionUser && (
        <Modal title={`Leave request (for ${leaveTargetDay})`} onClose={() => setLeaveOpen(false)}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="from date"><input type="date" value={leaveForm.from_date} onChange={(e) => setLeaveForm({ ...leaveForm, from_date: e.target.value })} style={inp} /></Field>
              <Field label="from time"><input type="time" value={leaveForm.from_time} onChange={(e) => setLeaveForm({ ...leaveForm, from_time: e.target.value })} style={inp} /></Field>
              <Field label="to date"><input type="date" value={leaveForm.to_date} onChange={(e) => setLeaveForm({ ...leaveForm, to_date: e.target.value })} style={inp} /></Field>
              <Field label="to time"><input type="time" value={leaveForm.to_time} onChange={(e) => setLeaveForm({ ...leaveForm, to_time: e.target.value })} style={inp} /></Field>
            </div>
            <Field label="reason">
              <textarea value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} rows={3} style={{ ...inp, width: "100%" }} />
            </Field>
            <div style={{ fontSize: 12, opacity: 0.75 }}>* ต้องลาล่วงหน้าอย่างน้อย 3 วัน</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setLeaveOpen(false)} style={btnSm}>Cancel</button>
              <button onClick={submitBusinessLeave} style={btnWarnSm}>Submit</button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}

// ---- styles ----
const card = { border: "1px solid #2b2b2b", borderRadius: 12, background: "#141a1f", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0, color: "white" };
const cardHeader = { padding: "10px 12px", borderBottom: "1px solid #2b2b2b", display: "flex", alignItems: "baseline", gap: 8 };

const labSmall = { fontSize: 11, opacity: 0.8, minWidth: 34 };
const selSmall = { padding: 6, borderRadius: 10, width: "100%", fontSize: 12 };
const inpSmall = { padding: 6, borderRadius: 10, width: "100%", fontSize: 12 };

const inp = { padding: 8, borderRadius: 10, width: "100%" };

const btnXs = { padding: "5px 8px", borderRadius: 10, cursor: "pointer", fontSize: 12 };
const btnWarnXs = { padding: "5px 8px", borderRadius: 10, cursor: "pointer", fontSize: 12 };
const btnSm = { padding: "6px 10px", borderRadius: 10, cursor: "pointer" };
const btnWarnSm = { padding: "6px 10px", borderRadius: 10, cursor: "pointer" };
const btnActive = { padding: "6px 10px", borderRadius: 10, cursor: "pointer", opacity: 1, background: "#0f1418", color: "white", border: "1px solid #2b2b2b" };

const selXs = { padding: 4, borderRadius: 10, width: "100%", fontSize: 12 };
const inpXs = { padding: 4, borderRadius: 10, width: "100%", fontSize: 12 };

const thXs = { textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #2b2b2b", fontSize: 12, opacity: 0.85 };
const tdXs = { padding: "4px 6px", borderBottom: "1px solid #2b2b2b", verticalAlign: "top", fontSize: 12 };

const modalBackdrop = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 };
const modalCard = { width: "min(820px, 100%)", background: "#0f1418", border: "1px solid #2b2b2b", borderRadius: 14, overflow: "hidden", color: "white" };
const modalHeader = { padding: "10px 12px", borderBottom: "1px solid #2b2b2b", display: "flex", alignItems: "center", gap: 10 };
