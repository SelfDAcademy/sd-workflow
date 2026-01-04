import { supabase } from "../supabaseClient";

export async function signInWithEmail(email, password) {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}
export function getSessionUser() {
  try {
    const raw = localStorage.getItem("sdwf_worklog_session_v3");
    if (!raw) return "";
    const v = JSON.parse(raw);
    return typeof v?.user === "string" ? v.user : "";
  } catch {
    return "";
  }
}
