import { supabase } from "../supabaseClient";
const LS_AUTH_PROFILE = "sdwf_auth_profile_v1";

function safeParseJSON(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function getCachedAuthProfile() {
  try {
    const raw = localStorage.getItem(LS_AUTH_PROFILE);
    if (!raw) return null;
    const v = safeParseJSON(raw, null);
    if (!v || typeof v !== "object") return null;
    const username = typeof v.username === "string" ? v.username : "";
    const role = typeof v.role === "string" ? v.role : "";
    const email = typeof v.email === "string" ? v.email : "";
    if (!username) return null;
    return { email, username, role };
  } catch {
    return null;
  }
}

export function setCachedAuthProfile(profile) {
  try {
    if (!profile) return;
    localStorage.setItem(LS_AUTH_PROFILE, JSON.stringify(profile));
  } catch {
    // ignore
  }
}

export async function getAuthProfile() {
  if (!supabase?.auth) return null;
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) return null;
  const user = userData?.user;
  if (!user?.id) return null;

  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("username, role, email")
    .eq("id", user.id)
    .single();

  if (profErr || !prof) return null;

  const out = {
    email: prof.email || user.email || "",
    username: String(prof.username || "").trim(),
    role: String(prof.role || "").trim(),
  };
  if (!out.username) return null;

  setCachedAuthProfile(out);
  return out;
}


export async function signInWithEmail(email, password) {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
  try { localStorage.removeItem(LS_AUTH_PROFILE); } catch {}
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
