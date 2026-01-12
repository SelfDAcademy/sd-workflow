import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// อนุญาต local mode เฉพาะ DEV และต้องตั้งใจเปิดเองเท่านั้น
const allowLocalMode =
  import.meta.env.DEV && import.meta.env.VITE_ALLOW_LOCAL_MODE === "true";

const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// PRODUCTION ต้องมี env ครบ ไม่งั้น “พังทันที” เพื่อกันเผลอไป localStorage
if (!isConfigured && !allowLocalMode) {
  throw new Error(
    "[sd-workflow] Missing env: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. " +
      "Set them in Vercel (Production) and redeploy."
  );
}

export const supabase = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "sd-workflow-auth",
      },
    })
  : null;
