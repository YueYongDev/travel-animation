import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  typeof __SUPABASE_URL__ === "string" ? __SUPABASE_URL__.trim() : "";
const supabaseAnonKey =
  typeof __SUPABASE_ANON_KEY__ === "string" ? __SUPABASE_ANON_KEY__.trim() : "";

export const EXPORT_CREDIT_COST = 1;

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: "trailframe.supabase.auth",
        },
        realtime: {
          params: {
            eventsPerSecond: 2,
          },
        },
      })
    : null;

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function wait(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

export function assertSupabaseConfigured() {
  if (supabase) return;

  throw new Error(
    "缺少 Supabase 前端配置。请设置 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY。",
  );
}

export async function getSession() {
  assertSupabaseConfigured();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function fetchProfile(userId) {
  assertSupabaseConfigured();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, credits, created_at, updated_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function waitForProfile(
  userId,
  { attempts = 10, delayMs = 250 } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const profile = await fetchProfile(userId);
    if (profile) return profile;
    if (attempt < attempts - 1) await wait(delayMs);
  }

  return null;
}

export function buildAuthState(session, profile) {
  const user = session?.user ?? null;
  const email = normalizeText(profile?.email) || normalizeText(user?.email);
  const displayName =
    normalizeText(profile?.display_name) ||
    normalizeText(user?.user_metadata?.display_name) ||
    normalizeText(user?.user_metadata?.full_name) ||
    email.split("@")[0]?.replace(/[._-]+/g, " ").trim() ||
    "TrailFrame";

  return {
    id: user?.id || profile?.id || "",
    email,
    displayName,
    credits:
      typeof profile?.credits === "number" && Number.isFinite(profile.credits)
        ? Math.max(0, profile.credits)
        : 0,
    provider: normalizeText(user?.app_metadata?.provider) || "email",
  };
}

export function getAuthDisplayName(authState) {
  return normalizeText(authState?.displayName) || "TrailFrame";
}

export function getAuthInitials(authState) {
  const initials = getAuthDisplayName(authState)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");

  return initials || "T";
}

export function getAuthProviderLabel(authState) {
  return authState?.provider === "github" ? "GitHub" : "Email";
}

export function getAuthErrorMessage(error, mode = "login") {
  const message = normalizeText(error?.message);
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("invalid login credentials")) {
    return "邮箱或密码错误。";
  }

  if (lowerMessage.includes("email not confirmed")) {
    return "请先完成邮箱验证，再登录。";
  }

  if (lowerMessage.includes("user already registered")) {
    return "该邮箱已注册，请直接登录。";
  }

  if (lowerMessage.includes("password should be at least")) {
    return "密码至少需要 6 位。";
  }

  if (lowerMessage.includes("signup is disabled")) {
    return "Supabase 当前未开启注册，请先到控制台打开邮箱注册。";
  }

  if (lowerMessage.includes("provider is not enabled")) {
    return "GitHub 登录暂未在 Supabase 中启用。";
  }

  if (lowerMessage.includes("database error saving new user")) {
    return "账号已创建，但积分档案初始化失败，请检查 Supabase SQL 脚本是否已经执行。";
  }

  if (message) return message;

  return mode === "register" ? "注册失败，请稍后重试。" : "登录失败，请稍后重试。";
}

export async function consumeCredits(amount, reason = "video_export") {
  assertSupabaseConfigured();
  const { data, error } = await supabase.rpc("consume_credits", {
    requested_amount: amount,
    requested_reason: reason,
    request_metadata: {
      source: "trailframe-workspace",
    },
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data;
}

export async function isEmailRegistered(email) {
  assertSupabaseConfigured();
  const normalizedEmail = normalizeText(email).toLowerCase();
  if (!normalizedEmail) return false;

  const { data, error } = await supabase.rpc("is_email_registered", {
    target_email: normalizedEmail,
  });

  if (error) {
    if (
      error.code === "PGRST202" ||
      normalizeText(error.message).toLowerCase().includes("is_email_registered")
    ) {
      return false;
    }
    throw error;
  }
  return Boolean(data);
}

export function subscribeToProfile(userId, onChange) {
  assertSupabaseConfigured();
  return supabase
    .channel(`profile:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "profiles",
        filter: `id=eq.${userId}`,
      },
      (payload) => {
        if (payload?.new) onChange(payload.new);
      },
    )
    .subscribe();
}

export async function signOut() {
  assertSupabaseConfigured();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
