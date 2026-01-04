import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "../supabaseClient";

export default function RequireAuth({ children }) {
  const loc = useLocation();
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function init() {
      if (!supabase) {
        if (mounted) {
          setAuthed(true);
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (mounted) {
        setAuthed(Boolean(data?.session));
        setLoading(false);
      }
    }

    init();

    const { data: sub } =
      supabase?.auth.onAuthStateChange((_event, session) => {
        if (!mounted) return;
        setAuthed(Boolean(session));
      }) || { data: null };

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  if (loading) return null;
  if (!authed) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return children;
}
