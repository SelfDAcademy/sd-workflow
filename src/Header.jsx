import { NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { getSessionUser, signOut } from "./auth/auth";

function Header() {
  const navigate = useNavigate();

  // ✅ Fix root cause: Header must react to Supabase auth changes.
  // Previously it read getSessionUser() once per render (often from stale localStorage),
  // so "login as" could show the previous user until you visited a page that forced re-hydration.
  const [user, setUser] = useState(() => {
    // Local mode fallback
    if (!supabase) return getSessionUser();
    return "";
  });

  useEffect(() => {
    let mounted = true;

    async function syncNow() {
      if (!supabase) {
        if (mounted) setUser(getSessionUser());
        return;
      }
      // Prefer real session user from Supabase
      const { data } = await supabase.auth.getSession();
      const email = data?.session?.user?.email || "";
      if (mounted) setUser(email);
    }

    syncNow();

    const { data: sub } =
      supabase?.auth.onAuthStateChange((_event, session) => {
        if (!mounted) return;
        const email = session?.user?.email || "";
        setUser(email);
      }) || { data: null };

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  const linkStyle = ({ isActive }) => ({
    color: isActive ? "#ffffff" : "#cbd5e1",
    textDecoration: "none",
    padding: "6px 10px",
    borderRadius: 6,
    background: isActive ? "rgba(255,255,255,0.15)" : "transparent",
    fontSize: 14,
  });

  async function handleLogout() {
    try {
      await signOut();
    } finally {
      setUser("");
      navigate("/login", { replace: true });
    }
  }

  return (
    <header
      style={{
        padding: "14px 24px",
        backgroundColor: "#0d1623",
        borderBottom: "2px solid #ffffff",
        display: "flex",
        alignItems: "center",
        gap: 20,
      }}
    >
      <div>
        <strong style={{ color: "#ffffff", fontSize: 16 }}>
          Self-D Academy Workflow
        </strong>
        <div style={{ fontSize: 12, color: "#e5e7eb" }}>
          Doer / Support / Supervisor
        </div>
      </div>

      <nav style={{ display: "flex", gap: 8, marginLeft: 24 }}>
        <NavLink to="/projects" style={linkStyle}>
          Projects
        </NavLink>
        <NavLink to="/tasks" style={linkStyle}>
          Tasks
        </NavLink>
        <NavLink to="/worklog" style={linkStyle}>
          Worklog
        </NavLink>
      </nav>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 12, color: "#e5e7eb", opacity: 0.9 }}>
          {user ? `login as: ${user}` : ""}
        </div>

        <button
          type="button"
          onClick={handleLogout}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.25)",
            background: "rgba(255,255,255,0.10)",
            color: "#ffffff",
            cursor: "pointer",
            fontSize: 13,
          }}
          title="Logout"
        >
          Logout
        </button>
      </div>
    </header>
  );
}

export default Header;
