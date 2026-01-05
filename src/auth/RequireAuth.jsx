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
      // Local mode: always allow
      if (!supabase) {
        if (mounted) {
          setAuthed(true);
          setLoading(false);
        }
        return;
      }

      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setAuthed(Boolean(data?.session));
      } catch {
        // If session check fails (env/CORS/network), do NOT hang forever
        if (!mounted) return;
        setAuthed(false);
      } finally {
        if (mounted) setLoading(false);
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
