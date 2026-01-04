import { NavLink, useNavigate } from "react-router-dom";
import { getSessionUser, signOut } from "./auth/auth";

function Header() {
  const navigate = useNavigate();
  const user = getSessionUser();

  const linkStyle = ({ isActive }) => ({
    color: isActive ? "#ffffff" : "#cbd5e1",
    textDecoration: "none",
    padding: "6px 10px",
    borderRadius: 6,
    background: isActive ? "rgba(255,255,255,0.15)" : "transparent",
    fontSize: 14,
  });

  function handleLogout() {
    signOut();
    navigate("/login", { replace: true });
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
