import { createContext, useContext, useEffect, useMemo, useState } from "react";
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

function newId(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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
}) {
  const baseAssigned = start_date;

  const baseTask = (task, deadline, doer, support) => ({
    id: newId("task"),
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
  const [projects, setProjects] = useState(() => {
    const raw = localStorage.getItem(LS_PROJECTS);
    return raw ? safeParse(raw, []) : [];
  });

  const [tasks, setTasks] = useState(() => {
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

  const supaEnabled = Boolean(supabase);

  useEffect(() => {
    if (!supaEnabled) return;

    let mounted = true;

    async function load() {
      const pRes = await supabase.from("projects").select("*").order("created_at", { ascending: false });
      if (!pRes.error && mounted) setProjects(pRes.data || []);

      const tRes = await supabase.from("tasks").select("*").eq("archived", false).order("created_at", { ascending: false });
      if (!tRes.error && mounted) setTasks(tRes.data || []);
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
    const { error } = await supabase.from("tasks").insert([newTask]);
    if (error) alert(error.message);
  }

  async function updateTask(id, patch) {
    if (!supaEnabled) {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      return;
    }
    const { error } = await supabase.from("tasks").update(patch).eq("id", id);
    if (error) alert(error.message);
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
    const project_id = `${project_kind}-${newId("P")}`;

    const project = {
      id: project_id,
      kind: project_kind,
      name,
      bu,
      supervisor,
      start_date,
      event_date: event_date || "",
      doer_default,
      support_default,
      created_at: new Date().toISOString(),
    };

    const wf = buildWorkflowTasks({
      project_id,
      project_kind,
      bu,
      supervisor,
      doer_default,
      support_default,
      start_date,
      event_date: event_date || start_date,
    });

    if (!supaEnabled) {
      setProjects((prev) => [project, ...prev]);
      setTasks((prev) => [...wf, ...prev]);
      return project_id;
    }

    const pIns = await supabase.from("projects").insert([project]);
    if (pIns.error) {
      alert(pIns.error.message);
      return project_id;
    }

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
