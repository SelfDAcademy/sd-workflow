// src/services/profileService.js
import { supabase } from "../supabaseClient";

/**
 * ข้อกำหนดตาราง public.profiles (ของคุณตอนนี้)
 * - id (uuid, PK) = auth.uid()
 * - email (text, NOT NULL)
 * - username (text, NOT NULL)
 * - role (text, NOT NULL) เช่น 'team' | 'supervisor'
 * - created_at (timestamptz, default now())
 */

function assertSupabaseReady() {
  if (!supabase) {
    throw new Error(
      "[profileService] Supabase is not configured. Check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY."
    );
  }
}

function defaultUsernameFromEmail(email) {
  if (!email || typeof email !== "string") return "user";
  const local = email.split("@")[0] || "user";

  // ให้เป็น slug แบบเบา ๆ (กันช่องว่าง/ตัวอักษรแปลก)
  // ✅ FIX: ย้าย "-" ไปท้ายสุดของ character class เพื่อไม่ให้เกิด Range out of order
  return local
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_.-]/g, "");
}

async function getAuthUserOrThrow() {
  assertSupabaseReady();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data?.user) throw new Error("[profileService] Not authenticated.");
  return data.user;
}

/**
 * ดึงรายชื่อโปรไฟล์ของทีม (ต้องเป็น authenticated)
 * @param {Object} [opts]
 * @param {string} [opts.orderBy='username']
 * @param {boolean} [opts.ascending=true]
 */
export async function listProfiles(opts = {}) {
  assertSupabaseReady();
  const { orderBy = "username", ascending = true } = opts;

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,username,role,created_at")
    .order(orderBy, { ascending });

  if (error) throw error;
  return data || [];
}

/**
 * ดึงโปรไฟล์ของตัวเอง (พร้อมสร้างให้ถ้ายังไม่มี row)
 * @param {Object} [opts]
 * @param {boolean} [opts.createIfMissing=true]
 */
export async function getMyProfile(opts = {}) {
  const { createIfMissing = true } = opts;
  const user = await getAuthUserOrThrow();

  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,username,role,created_at")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;

  if (data) return data;

  if (!createIfMissing) return null;

  // สร้างโปรไฟล์เริ่มต้น (ต้องมี policy insert own profile แล้ว)
  const payload = {
    id: user.id,
    email: user.email || "",
    username: defaultUsernameFromEmail(user.email),
    role: "team",
  };

  const { data: created, error: insertErr } = await supabase
    .from("profiles")
    .insert(payload)
    .select("id,email,username,role,created_at")
    .single();

  if (insertErr) throw insertErr;
  return created;
}

/**
 * อัปเดต/อัปเซิร์ตโปรไฟล์ตัวเอง (ปลอดภัยกับ NOT NULL)
 * - ถ้าไม่มีโปรไฟล์ จะ insert
 * - ถ้ามีแล้ว จะ update
 * @param {Object} patch
 * @param {string} [patch.username]
 * @param {string} [patch.role]
 * @param {string} [patch.email]  ปกติไม่แนะนำให้เปลี่ยนเอง แต่รองรับไว้
 */
export async function upsertMyProfile(patch = {}) {
  const user = await getAuthUserOrThrow();

  // ดึงของเดิมมาก่อน เพื่อเติมค่า required fields (NOT NULL)
  const existing = await getMyProfile({ createIfMissing: true });

  const next = {
    id: user.id,
    email: patch.email ?? existing.email ?? user.email ?? "",
    username:
      patch.username ??
      existing.username ??
      defaultUsernameFromEmail(user.email),
    role: patch.role ?? existing.role ?? "team",
  };

  // กันค่าว่างหลุด NOT NULL (ช่วยลด error)
  if (!next.email) next.email = user.email || "";
  if (!next.username) next.username = defaultUsernameFromEmail(next.email);
  if (!next.role) next.role = "team";

  const { data, error } = await supabase
    .from("profiles")
    .upsert(next, { onConflict: "id" })
    .select("id,email,username,role,created_at")
    .single();

  if (error) throw error;
  return data;
}

/**
 * utility: เช็คว่า user ปัจจุบันเป็น supervisor ไหม
 * @returns {Promise<boolean>}
 */
export async function isMyRoleSupervisor() {
  const me = await getMyProfile({ createIfMissing: true });
  return (me?.role || "").toLowerCase() === "supervisor";
}
