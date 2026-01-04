import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);

  // ตรวจว่ามี session จาก reset link จริงไหม
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) {
        setReady(true);
      } else {
        alert("ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว");
      }
      setLoading(false);
    });
  }, []);

  async function submit() {
    if (password.length < 6) {
      return alert("รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร");
    }
    if (password !== confirm) {
      return alert("รหัสผ่านไม่ตรงกัน");
    }

    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      alert(error.message);
      return;
    }

    // 🔗 หลังตั้งรหัสเสร็จ → เช็ก profile/role ต่อทันที
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("username, role")
        .eq("id", user.id)
        .single();

      // ถ้ายังไม่มี profile (กันพลาด)
      if (!profile) {
        await supabase.from("profiles").insert({
          id: user.id,
          email: user.email,
          username: user.email.split("@")[0],
          role: "team",
        });
      }
    }

    alert("ตั้งรหัสผ่านเรียบร้อยแล้ว");
    window.location.href = "/";
  }

  if (loading) {
    return <div style={{ padding: 40 }}>Loading...</div>;
  }

  if (!ready) {
    return <div style={{ padding: 40 }}>Invalid reset link</div>;
  }

  return (
    <div style={{ maxWidth: 420, margin: "80px auto", padding: 24 }}>
      <h2>ตั้งรหัสผ่านใหม่</h2>

      <div style={{ marginTop: 16 }}>
        <input
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", padding: 10, marginBottom: 10 }}
        />
        <input
          type="password"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          style={{ width: "100%", padding: 10 }}
        />
      </div>

      <button
        onClick={submit}
        style={{ marginTop: 16, padding: 10, width: "100%" }}
      >
        Save password
      </button>
    </div>
  );
}
