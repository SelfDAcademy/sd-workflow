// src/pages/ActionLogsPage.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { PEOPLE } from "../config";
import { isMyRoleSupervisor, listProfiles } from "../services/profileService";

const TZ = "Asia/Bangkok";
const PAGE_SIZE = 50;

function safeString(v) {
  if (v == null) return "";
  return String(v);
}

function fmtDateTimeTH(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return safeString(iso);

  try {
    return new Intl.DateTimeFormat("th-TH", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return d.toLocaleString("th-TH");
  }
}

function toISOFromDatetimeLocal(localValue) {
  const raw = safeString(localValue).trim();
  if (!raw) return "";
  const d = new Date(raw); // datetime-local => interpreted as local time
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function sanitizeForOrLike(input) {
  return safeString(input)
    .trim()
    .replace(/[,%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function Field({ label, children, hint }) {
  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>{label}</div>
      {children}
      {hint ? (
        <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>{hint}</div>
      ) : null}
    </div>
  );
}

function Panel({ title, rightActions, children }) {
  return (
    <div
      style={{
        border: "1px solid #2b2b2b",
        borderRadius: 14,
        overflow: "hidden",
        background: "#0f1418",
      }}
    >
      <div
        style={{
          padding: "10px",
          background: "#141a1f",
          borderBottom: "1px solid #2b2b2b",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 12 }}>{title}</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {rightActions}
        </div>
      </div>
      <div style={{ padding: 10 }}>{children}</div>
    </div>
  );
}

const inp = {
  width: "100%",
  padding: 8,
  borderRadius: 10,
  border: "1px solid #2b2b2b",
  background: "#0f1418",
  color: "white",
  fontSize: 12,
};

const btn = {
  padding: "7px 10px",
  borderRadius: 10,
  border: "1px solid #2b2b2b",
  background: "#141a1f",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
};

const btnPrimary = {
  ...btn,
  border: "1px solid rgba(255,255,255,0.25)",
  background: "rgba(255,255,255,0.10)",
};

function ActionLogsPage() {
  const [roleState, setRoleState] = useState({
    loading: true,
    isSupervisor: false,
    error: "",
  });

  const [profiles, setProfiles] = useState([]);
  const [topics, setTopics] = useState([]);

  const [actor, setActor] = useState("");
  const [topic, setTopic] = useState("");
  const [fromDt, setFromDt] = useState("");
  const [toDt, setToDt] = useState("");
  const [keyword, setKeyword] = useState("");

  const [logs, setLogs] = useState([]);
  const [expanded, setExpanded] = useState({});

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(null);

  const userOptions = useMemo(() => {
    const names = new Set();
    (profiles || []).forEach((p) => {
      if (p?.username) names.add(p.username);
    });
    (PEOPLE || []).forEach((n) => names.add(n));
    names.add("system");
    return Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [profiles]);

  const topicOptions = useMemo(() => {
    const base = new Set([
      "tasks",
      "projects",
      "weekly_plans",
      "worklog_logs",
      "reflections",
      "leave_requests",
      "project_tick_meta",
      "project_tick_cells",
    ]);
    (topics || []).forEach((t) => base.add(t));
    return Array.from(base).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [topics]);

  // Guard ชั้นใน (แม้ step ถัดไปจะมี RequireSupervisor)
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        if (!supabase) {
          if (!alive) return;
          setRoleState({
            loading: false,
            isSupervisor: false,
            error:
              "Supabase ยังไม่พร้อมใช้งาน (ตรวจ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)",
          });
          return;
        }

        const ok = await isMyRoleSupervisor();
        if (!alive) return;
        setRoleState({ loading: false, isSupervisor: ok, error: "" });
      } catch (e) {
        if (!alive) return;
        setRoleState({
          loading: false,
          isSupervisor: false,
          error: e?.message || "ตรวจสอบสิทธิ์ไม่สำเร็จ",
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  async function loadFilterOptions() {
    // profiles + topics
    try {
      const ps = await listProfiles({ orderBy: "username", ascending: true });
      setProfiles(ps || []);
    } catch {
      setProfiles((PEOPLE || []).map((u) => ({ id: u, username: u, role: "" })));
    }

    try {
      const { data, error: qErr } = await supabase
        .from("action_logs")
        .select("topic")
        .order("created_at", { ascending: false })
        .limit(500);

      if (qErr) throw qErr;
      const uniq = new Set();
      (data || []).forEach((r) => {
        const t = safeString(r?.topic).trim();
        if (t) uniq.add(t);
      });
      setTopics(Array.from(uniq));
    } catch {
      setTopics([]);
    }
  }

  async function fetchLogs({ nextPage = 0, append = false } = {}) {
    setError("");
    setLoading(true);

    try {
      if (!supabase) throw new Error("Supabase ยังไม่พร้อมใช้งาน");

      const offset = nextPage * PAGE_SIZE;
      const limitEnd = offset + PAGE_SIZE - 1;

      let q = supabase
        .from("action_logs")
        .select(
          "id,created_at,actor_id,actor_username,action_type,topic,summary,entity_table,entity_id,meta",
          { count: "exact" }
        );

      if (actor) q = q.eq("actor_username", actor);
      if (topic) q = q.eq("topic", topic);

      const fromISO = toISOFromDatetimeLocal(fromDt);
      const toISO = toISOFromDatetimeLocal(toDt);
      if (fromISO) q = q.gte("created_at", fromISO);
      if (toISO) q = q.lte("created_at", toISO);

      const kw = sanitizeForOrLike(keyword);
      if (kw) {
        q = q.or(`topic.ilike.%${kw}%,summary.ilike.%${kw}%,action_type.ilike.%${kw}%`);
      }

      const { data, error: qErr, count } = await q
        .order("created_at", { ascending: false })
        .range(offset, limitEnd);

      if (qErr) throw qErr;

      const rows = data || [];
      setLogs((prev) => (append ? [...prev, ...rows] : rows));
      setTotalCount(typeof count === "number" ? count : null);

      setHasMore(rows.length === PAGE_SIZE);
      setPage(nextPage);
    } catch (e) {
      setError(e?.message || "โหลด log ไม่สำเร็จ");
      if (!append) setLogs([]);
      setHasMore(false);
      setTotalCount(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch() {
    setExpanded({});
    await fetchLogs({ nextPage: 0, append: false });
  }

  async function handleReset() {
    setActor("");
    setTopic("");
    setFromDt("");
    setToDt("");
    setKeyword("");
    setExpanded({});
    await fetchLogs({ nextPage: 0, append: false });
  }

  async function handleLoadMore() {
    if (loading || !hasMore) return;
    await fetchLogs({ nextPage: page + 1, append: true });
  }

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!alive) return;
      if (roleState.loading) return;
      if (!roleState.isSupervisor) return;

      await loadFilterOptions();
      await fetchLogs({ nextPage: 0, append: false });
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleState.loading, roleState.isSupervisor]);

  const headerRight = (
    <button
      type="button"
      style={btn}
      onClick={handleSearch}
      disabled={loading || roleState.loading}
    >
      รีเฟรช
    </button>
  );

  const statText = useMemo(() => {
    const shown = logs.length;
    if (typeof totalCount === "number") return `แสดง ${shown} / ${totalCount} รายการ`;
    return `แสดง ${shown} รายการ`;
  }, [logs.length, totalCount]);

  if (roleState.loading) {
    return (
      <main style={{ padding: 24 }}>
        <Panel title="Logs (Supervisor)" rightActions={null}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>กำลังตรวจสอบสิทธิ์…</div>
        </Panel>
      </main>
    );
  }

  if (!roleState.isSupervisor) {
    return (
      <main style={{ padding: 24 }}>
        <Panel title="Logs (Supervisor only)" rightActions={null}>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>ไม่มีสิทธิ์เข้าถึง</div>
            <div style={{ opacity: 0.85 }}>
              แท็บนี้สำหรับ Supervisor เท่านั้น
              {roleState.error ? (
                <div style={{ marginTop: 10, color: "#fca5a5" }}>{roleState.error}</div>
              ) : null}
            </div>
          </div>
        </Panel>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, display: "grid", gap: 12 }}>
      <Panel title="Action Logs (Supervisor)" rightActions={headerRight}>
        <div style={{ display: "grid", gap: 10 }}>
          {/* Filters */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 10,
              alignItems: "end",
            }}
          >
            <Field label="ผู้ดำเนินการ (User)">
              <select
                value={actor}
                onChange={(e) => setActor(e.target.value)}
                style={{ ...inp, paddingRight: 28 }}
              >
                <option value="">ทั้งหมด</option>
                {userOptions.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="หัวข้อ (Topic)">
              <select
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                style={{ ...inp, paddingRight: 28 }}
              >
                <option value="">ทั้งหมด</option>
                {topicOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="ตั้งแต่ (วันเวลา)">
              <input
                type="datetime-local"
                value={fromDt}
                onChange={(e) => setFromDt(e.target.value)}
                style={inp}
              />
            </Field>

            <Field label="ถึง (วันเวลา)">
              <input
                type="datetime-local"
                value={toDt}
                onChange={(e) => setToDt(e.target.value)}
                style={inp}
              />
            </Field>

            <div style={{ gridColumn: "1 / span 3" }}>
              <Field label="ค้นหา (หัวข้อ/สรุป/ประเภทงาน)">
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearch();
                  }}
                  placeholder="เช่น leave, clock out, tasks.update, D-Camp…"
                  style={inp}
                />
              </Field>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={btnPrimary} onClick={handleSearch} disabled={loading}>
                ค้นหา
              </button>
              <button type="button" style={btn} onClick={handleReset} disabled={loading}>
                ล้างตัวกรอง
              </button>
            </div>
          </div>

          {/* Status */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{statText}</div>
            {loading ? <div style={{ fontSize: 12, opacity: 0.75 }}>กำลังโหลด…</div> : null}
            {error ? <div style={{ fontSize: 12, color: "#fca5a5" }}>{error}</div> : null}
          </div>

          {/* Table */}
          <div style={{ border: "1px solid #2b2b2b", borderRadius: 14, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ background: "#141a1f" }}>
                <tr>
                  <th style={{ textAlign: "left", padding: "10px", fontSize: 12, width: 34 }} />
                  <th style={{ textAlign: "left", padding: "10px", fontSize: 12, width: 170 }}>
                    วันเวลา
                  </th>
                  <th style={{ textAlign: "left", padding: "10px", fontSize: 12, width: 120 }}>
                    ผู้ทำ
                  </th>
                  <th style={{ textAlign: "left", padding: "10px", fontSize: 12, width: 160 }}>
                    ประเภทงาน
                  </th>
                  <th style={{ textAlign: "left", padding: "10px", fontSize: 12, width: 140 }}>
                    Topic
                  </th>
                  <th style={{ textAlign: "left", padding: "10px", fontSize: 12 }}>สรุป</th>
                </tr>
              </thead>

              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 12, fontSize: 12, opacity: 0.75 }}>
                      ยังไม่มีข้อมูล (หรือถูกกรองออกทั้งหมด)
                    </td>
                  </tr>
                ) : (
                  logs.map((r) => {
                    const isOpen = Boolean(expanded[r.id]);
                    return (
                      <FragmentRow
                        key={r.id}
                        row={r}
                        isOpen={isOpen}
                        onToggle={() => setExpanded((prev) => ({ ...prev, [r.id]: !prev[r.id] }))}
                      />
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              style={btn}
              onClick={handleLoadMore}
              disabled={loading || !hasMore}
              title={hasMore ? "โหลดเพิ่ม" : "ไม่มีข้อมูลเพิ่ม"}
            >
              โหลดเพิ่ม
            </button>
          </div>
        </div>
      </Panel>
    </main>
  );
}

function FragmentRow({ row, isOpen, onToggle }) {
  const td = {
    padding: "10px",
    fontSize: 12,
    verticalAlign: "top",
    borderBottom: "1px solid #2b2b2b",
  };

  const mini = (text) => (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.20)",
        background: "rgba(255,255,255,0.08)",
        fontSize: 11,
        opacity: 0.95,
        whiteSpace: "nowrap",
      }}
      title={safeString(text)}
    >
      {safeString(text)}
    </span>
  );

  return (
    <>
      <tr>
        <td style={{ ...td, width: 34 }}>
          <button type="button" onClick={onToggle} style={{ ...btn, padding: "4px 8px" }}>
            {isOpen ? "▾" : "▸"}
          </button>
        </td>
        <td style={td}>{fmtDateTimeTH(row.created_at)}</td>
        <td style={td}>{row.actor_username || "-"}</td>
        <td style={td}>{mini(row.action_type)}</td>
        <td style={td}>{row.topic || "-"}</td>
        <td style={{ ...td, whiteSpace: "pre-wrap" }}>
          {row.summary || "-"}
          {row.entity_table || row.entity_id ? (
            <div style={{ marginTop: 6, opacity: 0.75, fontSize: 11 }}>
              {row.entity_table ? `table: ${row.entity_table}` : ""}
              {row.entity_id ? ` · id: ${row.entity_id}` : ""}
            </div>
          ) : null}
        </td>
      </tr>

      {isOpen ? (
        <tr>
          <td colSpan={6} style={{ padding: 10, borderBottom: "1px solid #2b2b2b" }}>
            <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 8 }}>รายละเอียด (meta)</div>
            <pre
              style={{
                margin: 0,
                padding: 10,
                borderRadius: 12,
                border: "1px solid #2b2b2b",
                background: "#0b1014",
                color: "#e5e7eb",
                fontSize: 11,
                overflowX: "auto",
                maxHeight: 320,
              }}
            >
              {JSON.stringify(row.meta || {}, null, 2)}
            </pre>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default ActionLogsPage;
