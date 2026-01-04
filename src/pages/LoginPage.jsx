import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { signInWithEmail } from "../auth/auth";

export default function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [fpOpen, setFpOpen] = useState(false);
  const [fpEmail, setFpEmail] = useState("");
  const [fpLoading, setFpLoading] = useState(false);
  const [fpMsg, setFpMsg] = useState("");

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


  async function sendResetLink() {
    if (!supabase) return;
    setErr("");
    setFpMsg("");
    const targetEmail = (fpEmail || email || "").trim();
    if (!targetEmail) {
      setFpMsg("กรุณาใส่อีเมล");
      return;
    }
    try {
      setFpLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setFpLoading(false);
      if (error) {
        setFpMsg(error.message || "ส่งลิงก์ไม่สำเร็จ");
        return;
      }
      setFpMsg("ส่งลิงก์ตั้งรหัสผ่านไปที่อีเมลแล้ว");
      setFpOpen(false);
      setFpEmail("");
    } catch (e2) {
      setFpLoading(false);
      setFpMsg(e2?.message || "ส่งลิงก์ไม่สำเร็จ");
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

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
            <button
              type="button"
              onClick={() => {
                setFpMsg("");
                setFpEmail(email || "");
                setFpOpen((v) => !v);
              }}
              disabled={!supabase}
              style={{
                background: "transparent",
                border: 0,
                padding: 0,
                color: "#93c5fd",
                cursor: supabase ? "pointer" : "not-allowed",
                fontSize: 12,
                textDecoration: "underline",
                opacity: supabase ? 1 : 0.6,
              }}
            >
              Forgot password?
            </button>
            <div style={{ fontSize: 12, opacity: 0.6 }}>Invite → ตั้งรหัสผ่านครั้งแรก</div>
          </div>

          {fpOpen && (
            <div style={{ border: "1px solid #2b2b2b", borderRadius: 12, padding: 12, marginTop: 10, background: "#0f1418" }}>
              <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>Reset password</div>
              <input
                value={fpEmail}
                onChange={(e) => setFpEmail(e.target.value)}
                placeholder="Email"
                style={{ padding: 10, borderRadius: 10, width: "100%" }}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    setFpOpen(false);
                    setFpMsg("");
                  }}
                  style={{ padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={sendResetLink}
                  disabled={!supabase || fpLoading}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 10,
                    cursor: !supabase || fpLoading ? "not-allowed" : "pointer",
                    opacity: !supabase || fpLoading ? 0.6 : 1,
                  }}
                >
                  {fpLoading ? "Sending..." : "Send link"}
                </button>
              </div>
              {fpMsg && <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>{fpMsg}</div>}
            </div>
          )}

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
