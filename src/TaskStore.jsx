import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";

const TaskContext = createContext(null);

export function useTasks() {
  return useContext(TaskContext);
}

// ---- localStorage keys (fallback/local mode) ----
const LS_TASKS = "sdwf_tasks_v1";
const LS_PROJECTS = "sdwf_projects_v1";

// ---- helpers ----
function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function newId(prefix = "") {
  // Generate a real UUID (compatible with Supabase uuid columns).
  // Fallback keeps things working in older browsers/environments.
  const uuid =
    (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
    `${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}-${Math.random()
      .toString(16)
      .slice(2)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;

  // In LOCAL mode you may want readable prefixes; in Supabase mode we should never send prefixed ids.
  // We keep prefixing available for local ids only; DB inserts will strip non-uuid ids anyway.
  return prefix ? `${prefix}_${uuid}` : uuid;
}


function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isUuid(v) {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function stripInvalidUuidIds(obj, fields) {
  const out = { ...obj };
  for (const f of fields) {
    if (f in out && out[f] != null && typeof out[f] === "string" && !isUuid(out[f])) {
      delete out[f];
    }
  }
  return out;
}

function buildWorkflowTasks({
  project_id,
  project_kind,
  bu,
  supervisor,
  doer_default,
  support_default,
  start_date,
  event_date,
  include_task_id = true,
}) {
  const baseAssigned = start_date;

  const baseTask = (task, deadline, doer, support) => ({
    ...(include_task_id ? { id: newId("task") } : {}),
    project_id,
    project: project_kind,
    bu,
    created_by: supervisor,
    assigned_date: baseAssigned,
    type: "routine",
    task,
    doer,
    support,
    status: "not started",
    focus: "high",
    tag: "workflow",
    deadline,
    work_at: "",
    work_at_history: [],
    result: "",
    result_submitted: false,
    confirmed: false,
    followup_done: [false, false, false],
    archived: false,
  });

  if (project_kind === "DCP") {
    const ev = event_date || start_date;

    return [
      baseTask("ประสานงานโรงเรียน (confirm กำหนดการ/ผู้ประสานงาน)", addDays(ev, -21), doer_default, support_default),
      baseTask("เตรียมทะเบียน/สวัสดิการ/เอกสาร (รายชื่อ/แบบฟอร์ม)", addDays(ev, -14), support_default !== "-" ? support_default : doer_default, support_default),
      baseTask("ทำแผนกิจกรรม/สไลด์/อุปกรณ์ (พร้อม checklist)", addDays(ev, -10), doer_default, support_default),
      baseTask("นัดซ้อมทีม / run-through (บทบาทหน้างาน)", addDays(ev, -7), doer_default, support_default),
      baseTask("เตรียมสถานที่/การเดินทาง/หน้างาน (logistics)", addDays(ev, -2), doer_default, support_default),
      baseTask("Onsite: จัดกิจกรรมที่โรงเรียน (วันจริง)", ev, doer_default, support_default),
      baseTask("สรุปผลกิจกรรม + รายงาน (รูป/ตัวเลข/feedback)", addDays(ev, 2), doer_default, support_default),
      baseTask("Follow-up + เสนอขายต่อ (DCP → DC / โปรแกรมอื่น)", addDays(ev, 7), doer_default, support_default),
    ];
  }

  return [
    baseTask("เก็บ requirement/brief และกำหนด scope", addDays(start_date, 2), doer_default, support_default),
    baseTask("เตรียมเนื้อหา/กิจกรรมหลัก (draft)", addDays(start_date, 7), doer_default, support_default),
    baseTask("รีวิว/ปรับแก้ + finalize", addDays(start_date, 14), doer_default, support_default),
    baseTask("ส่งมอบ/สรุปผล + next action", addDays(start_date, 16), doer_default, support_default),
  ];
}

export function TaskProvider({ children }) {
  const supaEnabled = Boolean(supabase);

  const [projects, setProjects] = useState(() => {
    // ✅ In Supabase mode, start from empty to avoid flicker from stale localStorage data.
    // LocalStorage is only used in LOCAL mode.
    if (supaEnabled) return [];
    const raw = localStorage.getItem(LS_PROJECTS);
    return raw ? safeParse(raw, []) : [];
  });

  const [tasks, setTasks] = useState(() => {
    // ✅ In Supabase mode, start from empty to avoid flicker from stale localStorage/seed data.
    // LocalStorage/seed are only for LOCAL mode.
    if (supaEnabled) return [];
    const raw = localStorage.getItem(LS_TASKS);
    if (raw) return safeParse(raw, []);
    return [
      {
        id: "task_seed_1",
        project_id: "DC-SEED",
        project: "DC",
        bu: "BU1",
        created_by: "fah",
        assigned_date: "2025-12-25",
        type: "routine",
        task: "ตอบแชทลูกค้า SD Folio",
        doer: "meen",
        support: "-",
        status: "ongoing",
        focus: "high",
        tag: "workflow",
        deadline: "2025-12-29",
        work_at: "",
        work_at_history: [],
        result: "",
        result_submitted: false,
        confirmed: false,
        followup_done: [false, false, false],
        archived: false,
      },
    ];
  });


  // Track tasks being updated locally to prevent the periodic reload from "flickering" values.
  const pendingTaskIdsRef = useRef(new Set());

  function mergeServerTasksPreservingPending(prev, server) {
    const pending = pendingTaskIdsRef.current;
    if (!pending || pending.size === 0) return server;
    const prevById = new Map((prev || []).map((x) => [x.id, x]));
    return (server || []).map((row) => (pending.has(row.id) ? (prevById.get(row.id) || row) : row));
  }

// Ensure requests that need RLS-protected writes are authenticated (have a Supabase session).
async function ensureAuthenticated() {
  if (!supaEnabled) return { ok: false, session: null };
  const { data, error } = await supabase.auth.getSession();
  const session = data?.session || null;
  if (error || !session) {
    alert("ต้อง Login ด้วยอีเมลก่อน จึงจะสร้าง/แก้ไข Projects และ Tasks ได้");
    return { ok: false, session: null };
  }
  return { ok: true, session };
}

  useEffect(() => {
    if (!supaEnabled) return;

    let mounted = true;

    async function load() {
      // Fetch both datasets first, then update state together to reduce UI flicker/races.
      const [pRes, tRes] = await Promise.all([
        supabase.from("projects").select("*").order("created_at", { ascending: false }),
        supabase.from("tasks").select("*").eq("archived", false).order("created_at", { ascending: false }),
      ]);

      if (!mounted) return;

      if (!pRes.error) {
        setProjects(
          (pRes.data || []).map((p) => ({
            ...p,
            id: p.id || p.project_id || p.projectId || p.project_id,
            name: p.name ?? p.title ?? p.project_name ?? p.projectTitle ?? "",
          }))
        );
      }

      if (!tRes.error) {
        setTasks((prev) => mergeServerTasksPreservingPending(prev, tRes.data || []));
      }
    }

    load();
    const id = setInterval(load, 2000);

    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [supaEnabled]);

  useEffect(() => {
    if (supaEnabled) return;
    localStorage.setItem(LS_TASKS, JSON.stringify(tasks));
  }, [tasks, supaEnabled]);

  useEffect(() => {
    if (supaEnabled) return;
    localStorage.setItem(LS_PROJECTS, JSON.stringify(projects));
  }, [projects, supaEnabled]);

  async function addTask(newTask) {
    if (!supaEnabled) {
      setTasks((prev) => [newTask, ...prev]);
      return;
    }
    const auth = await ensureAuthenticated();
    if (!auth.ok) return;

    // IMPORTANT: When tables use uuid columns, never send non-uuid ids (e.g. "t_06jkf0i").
    const safeTask = stripInvalidUuidIds(newTask, ["id", "project_id"]);

    const { data, error } = await supabase
      .from("tasks")
      .insert([safeTask])
      .select("*")

    if (error) {
      alert(error.message);
      return;
    }

    // Keep local state in sync immediately (so subsequent updates use the real uuid id).
    // If RLS prevents RETURNING the row, keep a local copy; polling will reconcile later.
    if (data && data[0]) {
      setTasks((prev) => [(data && data[0]) || safeTask, ...prev]);
    } else {
      setTasks((prev) => [safeTask, ...prev]);
    }
  }

  async function updateTask(id, patch) {
    if (!supaEnabled) {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      return;
    }
    const auth = await ensureAuthenticated();
    if (!auth.ok) return;
    if (!isUuid(id)) {
      alert("Task id ไม่ถูกต้อง (ไม่ใช่ uuid) จึงไม่สามารถอัปเดตบน Supabase ได้");
      return;
    }

    // Optimistic UI update (no UI changes; just keeps local state consistent)
    pendingTaskIdsRef.current.add(id);
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

    const { data, error } = await supabase
      .from("tasks")
      .update(patch)
      .eq("id", id)
      .select("id");

    // data is an array of updated rows (possibly empty)

    if (error) {
      pendingTaskIdsRef.current.delete(id);
      alert(error.message);
      return;
    }

    // If no rows were updated, PostgREST returns an empty array.
// This usually means the row wasn't found or RLS blocked the update.
if (!data || data.length === 0) {
      pendingTaskIdsRef.current.delete(id);
      alert("อัปเดตไม่สำเร็จ (ไม่พบแถวที่ถูกแก้ไข) — อาจเป็นสิทธิ์/RLS หรือ id ไม่ตรงกับข้อมูลใน DB");
      return;
    }

// Keep optimistic state; polling will reconcile if needed.
pendingTaskIdsRef.current.delete(id);
  }

  async function createProject({
    project_kind,
    name,
    bu = "BU1",
    supervisor,
    doer_default = "meen",
    support_default = "-",
    start_date,
    event_date,
  }) {
    // Local mode keeps simple readable ids.
    const local_project_id = `${project_kind}-${newId("P")}`;

    const project = {
      kind: project_kind,
      name,
      title: name, // satisfy DB NOT NULL title; keep name for UI
      bu,
      supervisor,
      // DB schema requires a primary doer/owner on projects.
      // Use doer_default to satisfy NOT NULL constraint without affecting UI.
      doer: doer_default,
      start_date,
      event_date: event_date || "",
      doer_default,
      support_default,
      created_at: new Date().toISOString(),
    };

    // For Supabase insert, send only columns that are expected by DB.
    // (Keep UI-friendly fields like `name` in local state even if DB schema uses `title`.)
    const insertProject = { ...project };
    // If your DB does not have `name` column, avoid insert errors:
    delete insertProject.name;

    if (!supaEnabled) {
      const projectLocal = { id: local_project_id, ...project };
      const wfLocal = buildWorkflowTasks({
        project_id: local_project_id,
        project_kind,
        bu,
        supervisor,
        doer_default,
        support_default,
        start_date,
        event_date: event_date || start_date,
        include_task_id: true,
      });
      setProjects((prev) => [projectLocal, ...prev]);
      setTasks((prev) => [...wfLocal, ...prev]);
      return local_project_id;
    }

    const auth = await ensureAuthenticated();
    if (!auth.ok) return null;

    // Supabase mode: let DB generate uuid `projects.id` and use that uuid for tasks.project_id.
    const pIns = await supabase.from("projects").insert([insertProject]).select("project_id");
    if (pIns.error) {
      alert(pIns.error.message);
      return null;
    }

    const project_id = (pIns.data && pIns.data[0] && pIns.data[0].project_id) || null;
    if (!project_id) {
      alert("สร้างโปรเจกต์สำเร็จ แต่ไม่สามารถอ่าน id กลับมาได้ (ตรวจ RLS/permissions)");
      return null;
    }

    // Keep projects list in sync immediately
    setProjects((prev) => [{ id: project_id, project_id, ...project }, ...prev]);

    const wf = buildWorkflowTasks({
      project_id,
      project_kind,
      bu,
      supervisor,
      doer_default,
      support_default,
      start_date,
      event_date: event_date || start_date,
      include_task_id: false, // tasks.id should be generated by DB (uuid)
    }).map((t) => stripInvalidUuidIds(t, ["id", "project_id"]));

    const tIns = await supabase.from("tasks").insert(wf);
    if (tIns.error) alert(tIns.error.message);

    return project_id;
  }

  const value = useMemo(
    () => ({
      projects,
      tasks,
      addTask,
      updateTask,
      createProject,
    }),
    [projects, tasks]
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}
