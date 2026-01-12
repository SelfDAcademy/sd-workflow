// src/auth/RequireSupervisor.jsx
import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { isMyRoleSupervisor } from "../services/profileService";

export default function RequireSupervisor({ children }) {
  const loc = useLocation();
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function init() {
      // Local mode (ไม่มี supabase): อนุญาตผ่านเพื่อ dev
      if (!supabase) {
        if (mounted) {
          setAllowed(true);
          setLoading(false);
        }
        return;
      }

      try {
        const ok = await isMyRoleSupervisor();
        if (!mounted) return;
        setAllowed(Boolean(ok));
      } catch {
        if (!mounted) return;
        setAllowed(false);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return null;

  if (!allowed) {
    // มี RequireAuth ครอบไว้อยู่แล้ว ดังนั้นกรณีนี้คือ "ล็อกอินแล้วแต่ไม่ใช่ supervisor"
    return <Navigate to="/tasks" replace state={{ from: loc.pathname }} />;
  }

  return children;
}
