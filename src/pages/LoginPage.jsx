import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { signInWithEmail } from "../auth/auth";

export default function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      if (data?.session) nav("/tasks", { replace: true });
    })();
  }, [nav]);

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    try {
      await signInWithEmail(email, pass);
      nav("/tasks", { replace: true });
    } catch (e2) {
      setErr(e2?.message || "Login failed");
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <form
        onSubmit={onSubmit}
        style={{
          width: 420,
          maxWidth: "95vw",
          border: "1px solid #2b2b2b",
          borderRadius: 14,
          padding: 16,
          background: "#141a1f",
          color: "white",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Login</h2>
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 12 }}>
          {supabase ? "Shared workspace (Supabase)" : "Local mode (Supabase not configured)"}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ fontSize: 12, opacity: 0.8 }}>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: 10, borderRadius: 10 }} />

          <label style={{ fontSize: 12, opacity: 0.8 }}>Password</label>
          <input value={pass} onChange={(e) => setPass(e.target.value)} type="password" style={{ padding: 10, borderRadius: 10 }} />

          {err && <div style={{ color: "#fca5a5", fontSize: 12 }}>{err}</div>}

          <button
            type="submit"
            disabled={!supabase}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              cursor: supabase ? "pointer" : "not-allowed",
              opacity: supabase ? 1 : 0.6,
            }}
          >
            Sign in
          </button>

          {!supabase && (
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              ตั้งค่า VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY ใน Netlify/Vite ก่อน
            </div>
          )}
        </div>
      </form>
    </main>
  );
}
