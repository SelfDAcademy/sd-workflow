import { useMemo, useState, useEffect } from "react";
import { useTasks } from "../TaskStore";
import { PEOPLE } from "../config";

/*
แก้ตามที่ฟ้าขอ (เฉพาะประเด็น):
1) doer/support ใน Create Project (Template) -> เป็น owner หลักของโปรเจกต์ที่สร้าง (ส่งเข้า createProject เป็น doer_default/support_default)
2) Task ย่อยของโปรเจกต์ แสดง doer/support ของแต่ละ task (ไม่บังคับเท่ากับ owner)
3) เปลี่ยน bar graph เป็น tick box รายวัน
4) tickbox เริ่มจาก start_date จริง
5) tickbox แสดงทุกวันตั้งแต่ start_date -> event_date และมี "+" หลัง event_date เพื่อเพิ่มวันเผื่อเลื่อนแผน (จนถึง end ของโปรเจกต์)
6) kind=DC เลือก event date ได้ด้วย
7) recheck syntax/ไม่ให้ error import ./config (ใช้ ../config)
*/

const LS_PROJECT_TICKS = "sdwf_project_ticks_v2";
const LS_PROJECT_OWNERS = "sdwf_project_owners_v1";

function fmtDM(ymd) {
  if (!ymd) return "-";
  const [y, m, d] = String(ymd).split("-");
  if (!y || !m || !d) return String(ymd);
  return `${Number(d)}/${Number(m)}`;
}

function ymdLocal(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysYMD(ymd, days) {
  const dt = new Date(`${ymd}T00:00:00`);
  dt.setDate(dt.getDate() + days);
  return ymdLocal(dt);
}

function dayRange(startYmd, endYmd) {
  if (!startYmd || !endYmd) return [];
  const start = new Date(`${startYmd}T00:00:00`);
  const end = new Date(`${endYmd}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const out = [];
  const cur = new Date(start);
  while (cur <= end) {
    out.push(ymdLocal(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}


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

function getProjectEnd(project, tasks) {
  const ends = tasks.map((t) => t.deadline || t.due_date || t.dueDate).filter(Boolean);
  if (ends.length > 0) {
    ends.sort((a, b) => Date.parse(a) - Date.parse(b));
    return ends[ends.length - 1];
  }
  return project.event_date || project.eventDate || project.start_date || project.startDate;
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function TickButton({ value, onClick }) {
  const v = Number(value || 0); // 0 empty, 1 blue, 2 blue+check
  const bg = v === 0 ? "transparent" : "#2563eb";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: 18,
        height: 18,
        borderRadius: 4,
        border: "1px solid #2b2b2b",
        background: bg,
        color: "white",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        lineHeight: 1,
      }}
      aria-label="tick"
      title="คลิก: ฟ้า → ✓ → ล้าง"
    >
      {v === 2 ? "✓" : ""}
    </button>
  );
}

function ProjectTickTable({ project, tasks, updateTask }) {
  const startYmd = project.start_date || project.startDate || project.start;
  const endYmd = getProjectEnd(project, tasks);
  const eventYmd = project.event_date || project.eventDate || endYmd || startYmd;

  const baseDays = useMemo(() => dayRange(startYmd, eventYmd), [startYmd, eventYmd]);
  const tailDays = useMemo(() => {
    if (!eventYmd || !endYmd) return [];
    const next = addDaysYMD(eventYmd, 1);
    if (Date.parse(next) > Date.parse(endYmd)) return [];
    return dayRange(next, endYmd);
  }, [eventYmd, endYmd]);

  const [store, setStore] = useState(() => parseJSON(LS_PROJECT_TICKS, {}));
  useEffect(() => setJSON(LS_PROJECT_TICKS, store), [store]);

  const state = store[project.id] || { extraDays: 0, ticks: {} };
  const extraDays = Math.max(0, Math.min(state.extraDays || 0, tailDays.length));
  const shownDays = [...baseDays, ...tailDays.slice(0, extraDays)];
  const canAdd = extraDays < tailDays.length;

  function toggleTick(taskId, day) {
    setStore((prev) => {
      const next = { ...prev };
      const p = next[project.id] ? { ...next[project.id] } : { extraDays: 0, ticks: {} };
      const ticks = p.ticks ? { ...p.ticks } : {};
      const row = ticks[taskId] ? { ...ticks[taskId] } : {};
      const cur = Number(row[day] || 0); const nxt = cur === 0 ? 1 : cur === 1 ? 2 : 0; row[day] = nxt;
      ticks[taskId] = row;
      p.ticks = ticks;
      p.extraDays = typeof p.extraDays === "number" ? p.extraDays : 0;
      next[project.id] = p;
      return next;
    });
  }

  function addExtraDay() {
    if (!canAdd) return;
    setStore((prev) => {
      const next = { ...prev };
      const p = next[project.id] ? { ...next[project.id] } : { extraDays: 0, ticks: {} };
      p.extraDays = Math.min((p.extraDays || 0) + 1, tailDays.length);
      next[project.id] = p;
      return next;
    });
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          timeline: <b>{fmtDM(startYmd)}</b> → <b>{fmtDM(eventYmd)}</b>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={addExtraDay} disabled={!canAdd} style={{ ...btnSm, opacity: canAdd ? 1 : 0.5 }}>
            +
          </button>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            * หลัง event date กด “+” เพื่อเพิ่มวันเผื่อเลื่อนแผน
          </div>
        </div>
      </div>

      <div style={{ marginTop: 10, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 280, textAlign: "left" }}>task</th>
              {shownDays.map((d) => (
                <th key={d} style={{ ...th, textAlign: "center", width: 44 }}>
                  {fmtDM(d)}
                </th>
              ))}
              <th style={{ ...th, width: 44 }} />
            </tr>
          </thead>

          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td style={td}>
                  <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>{t.task}</div>
                  <div style={{ fontSize: 11, opacity: 0.7, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span>doer:</span>
                    <select
                      value={t.doer || ""}
                      onChange={(e) => updateTask?.(t.id, { doer: e.target.value })}
                      style={{ fontSize: 11, padding: "2px 6px", borderRadius: 8 }}
                      title="task doer"
                    >
                      <option value="">(optional)</option>
                      {PEOPLE.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>

                    <span>support:</span>
                    <select
                      value={t.support || ""}
                      onChange={(e) => updateTask?.(t.id, { support: e.target.value })}
                      style={{ fontSize: 11, padding: "2px 6px", borderRadius: 8 }}
                      title="task support"
                    >
                      <option value="">(optional)</option>
                      {PEOPLE.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>

                    <span>type:{t.type}</span>
                    <span>deadline:{fmtDM(t.deadline || t.due_date || t.dueDate)}</span>
                  </div>
                </td>

                {shownDays.map((d) => {
                  const value = Number(state.ticks?.[t.id]?.[d] || 0);
                  return (
                    <td key={d} style={{ ...td, textAlign: "center" }}>
                      <TickButton value={value} onClick={() => toggleTick(t.id, d)} />
                    </td>
                  );
                })}

                <td style={{ ...td, textAlign: "center", opacity: 0.7 }} />
              </tr>
            ))}

            {tasks.length === 0 && (
              <tr>
                <td colSpan={shownDays.length + 2} style={{ padding: 10, opacity: 0.7 }}>
                  ยังไม่มี tasks
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProjectInstance({ project, tasks, updateTask }) {
  // owner doer/support should come from Create Project defaults; fallback to first task if project object doesn't store them
    // owner doer/support should come from Create Project (Template) ONLY (doer_default/support_default)
    // owner doer/support should come from Create Project (Template) ONLY (doer_default/support_default)
  // If TaskStore doesn't persist these fields, we read from localStorage snapshot saved at creation time.
  const ownersStore = useMemo(() => parseJSON(LS_PROJECT_OWNERS, {}), []);
  const ownersSnap = ownersStore?.[project.id] || {};

  const ownerDoer =
    project.doer_default ||
    project.doerDefault ||
    project.doer ||
    project.owner_doer ||
    ownersSnap.doer ||
    "";

  const ownerSupport =
    project.support_default ||
    project.supportDefault ||
    project.support ||
    project.owner_support ||
    ownersSnap.support ||
    "";

  return (
    <section style={{ border: "1px solid #2b2b2b", borderRadius: 12, padding: 12, marginTop: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>
          {project.kind} · {project.name}
        </h3>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          id: {project.id} · BU:{project.bu} · supervisor:{project.supervisor}
          {ownerDoer ? ` · doer:${ownerDoer}` : " · doer:-"}
          {ownerSupport && ownerSupport !== "-" ? ` · support:${ownerSupport}` : " · support:-"}
        </div>
      </div>

      <ProjectTickTable project={project} tasks={tasks} updateTask={updateTask} />
    </section>
  );
}


export default function ProjectsPage() {
  const { projects, tasks, createProject, updateTask } = useTasks();

  const [form, setForm] = useState({
    kind: "DC",
    name: "",
    bu: "BU1",
    supervisor: "fah",
    doer_default: "meen",
    support_default: "-",
    start_date: "",
    event_date: "",
  });

  function onCreate() {
    if (!form.name.trim()) return alert("ใส่ชื่อโปรเจกต์ก่อน");
    if (!form.start_date) return alert("ใส่ start date");
    // ✅ DC ก็เลือก event date ได้, ถ้าไม่ใส่จะ default = start_date
    if ((form.kind === "DCP" || form.kind === "DC") && !form.event_date) {
      // ไม่บังคับ แต่ช่วยให้ชัด
      // (ถ้าอยากบังคับก็เปลี่ยนเป็น return alert)
    }

    const pid = createProject({
      project_kind: form.kind,
      name: form.name.trim(),
      bu: form.bu,
      supervisor: form.supervisor,
      doer_default: form.doer_default,
      support_default: form.support_default,
      start_date: form.start_date,
      event_date: form.event_date || form.start_date,
    });

    // ✅ persist project owners from Create Project form (so header always shows form values)
    const ownersStore = parseJSON(LS_PROJECT_OWNERS, {});
    ownersStore[pid] = { doer: form.doer_default || "", support: form.support_default || "" };
    setJSON(LS_PROJECT_OWNERS, ownersStore);

    alert(`สร้างโปรเจกต์สำเร็จ ✅\nproject_id: ${pid}`);
  }

  const visibleProjects = useMemo(() => {
    return projects.filter((p) => p.kind === "DC" || p.kind === "DCP");
  }, [projects]);

  const tasksByProject = useMemo(() => {
    // ✅ Stable grouping (no dependency on visibleProjects)
    // เหตุผล: บางครั้ง visibleProjects / projects อาจ hydrate ทีหลัง ทำให้ task โผล่แว๊บเดียวแล้วหาย (race)
    // เราเลย group ตาม project_id อย่างเดียว แล้วค่อยเลือกโชว์ตอน render ด้วย p.id
    const map = new Map();

    for (const t of tasks) {
      const pid = t.project_id || t.projectId;
      if (!pid) continue;

      if (!map.has(pid)) map.set(pid, []);
      map.get(pid).push(t);
    }

    // Sort: deadline ก่อน (ถ้ามี) ไม่งั้นเรียงตาม created_at
    for (const [pid, arr] of map.entries()) {
      arr.sort((a, b) => {
        const ad = a.deadline || a.due_date || a.dueDate;
        const bd = b.deadline || b.due_date || b.dueDate;
        const aTime = ad ? Date.parse(ad) : Number.POSITIVE_INFINITY;
        const bTime = bd ? Date.parse(bd) : Number.POSITIVE_INFINITY;
        if (aTime !== bTime) return aTime - bTime;

        const ac = a.created_at ? Date.parse(a.created_at) : 0;
        const bc = b.created_at ? Date.parse(b.created_at) : 0;
        return ac - bc;
      });
      map.set(pid, arr);
    }

    return map;
  }, [tasks]);

  return (
    <main style={{ padding: 24 }}>
      <h2>Projects</h2>
      <p style={{ opacity: 0.7 }}>
        แสดงเฉพาะโปรเจกต์ที่ kind = DC/DCP และแสดง tickbox รายวัน (เพิ่มวันได้ด้วยปุ่ม + หลัง event date)
      </p>

      {/* Create Project */}
      <div style={{ border: "1px solid #2b2b2b", borderRadius: 12, padding: 12, background: "#141a1f" }}>
        <strong>Create Project (Template)</strong>

        <div
          style={{
            marginTop: 10,
            display: "grid",
            gridTemplateColumns: "120px 220px 120px 140px 140px 140px 160px 160px",
            gap: 8,
          }}
        >
          <Field label="kind">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} style={inp}>
              <option value="DC">DC</option>
              <option value="DCP">DCP</option>
            </select>
          </Field>

          <Field label="name">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inp} />
          </Field>

          <Field label="BU">
            <select value={form.bu} onChange={(e) => setForm({ ...form, bu: e.target.value })} style={inp}>
              <option value="BU1">BU1</option>
              <option value="BU2">BU2</option>
              <option value="comp.">comp.</option>
            </select>
          </Field>

          <Field label="supervisor">
            <select value={form.supervisor} onChange={(e) => setForm({ ...form, supervisor: e.target.value })} style={inp}>
              <option value="fah">fah</option>
              <option value="pluem">pluem</option>
              <option value="namtip">namtip</option>
            </select>
          </Field>

          {/* ✅ doer/support เป็น owner หลักของโปรเจกต์ */}
          <Field label="doer default">
            <select value={form.doer_default} onChange={(e) => setForm({ ...form, doer_default: e.target.value })} style={inp}>
              {PEOPLE.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>

          <Field label="support default">
            <select value={form.support_default} onChange={(e) => setForm({ ...form, support_default: e.target.value })} style={inp}>
              <option value="-">-</option>
              {PEOPLE.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>

          <Field label="start date">
            <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} style={inp} />
          </Field>

          {/* ✅ DC ก็เลือก event date ได้ */}
          <Field label={`event date (${form.kind})`}>
            <input
              type="date"
              value={form.event_date}
              onChange={(e) => setForm({ ...form, event_date: e.target.value })}
              style={inp}
            />
          </Field>
        </div>

        <div style={{ marginTop: 10 }}>
          <button onClick={onCreate} style={btn}>
            Create project
          </button>
          <span style={{ marginLeft: 10, fontSize: 12, opacity: 0.7 }}>* กดแล้วระบบจะสร้าง workflow tasks อัตโนมัติ</span>
        </div>
      </div>

      {/* Projects */}
      <div style={{ marginTop: 14 }}>
        {visibleProjects.length === 0 && <div style={{ opacity: 0.7, marginTop: 14 }}>ยังไม่มีโปรเจกต์ DC/DCP</div>}

        {visibleProjects.map((p) => {
          const arr = tasksByProject.get(p.id) || [];
          return <ProjectInstance key={p.id} project={p} tasks={arr} updateTask={updateTask} />;
        })}
      </div>
    </main>
  );
}

const inp = { width: "100%", padding: 8, borderRadius: 10, border: "1px solid #2b2b2b", background: "#0f1418", color: "white" };
const btn = { padding: "8px 12px", borderRadius: 10, cursor: "pointer" };
const btnSm = { padding: "6px 10px", borderRadius: 10, cursor: "pointer" };

const th = { padding: "6px 8px", borderBottom: "1px solid #2b2b2b", background: "#141a1f", color: "white", fontWeight: 800, fontSize: 12 };
const td = { padding: "6px 8px", borderBottom: "1px solid #2b2b2b", verticalAlign: "top", background: "#0f1418", color: "white" };
