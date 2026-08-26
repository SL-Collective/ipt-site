
export const CONFIG = {
  supabaseUrl: globalThis.__IPT_SUPABASE_URL__ ?? "https://ztvfbdxyjdoeofxmojan.supabase.co",
  supabaseAnonKey: globalThis.__IPT_SUPABASE_ANON_KEY__ ?? "sb_publishable_ebS1tB1SI33MnvSWuOszIQ_eDE07Tau",

  vapidPublicKey: globalThis.__IPT_VAPID_PUBLIC_KEY__ ?? "BEQRAWQJzLWNE_puYr6s6yhmSovV8ZjagIx-OPJB1IpGIsQ7BxlSxVPPrJ6myeQJoQ1EKBVUI5xOly4d1LKAiO4",
};

export function isConfigured() {
  return !CONFIG.supabaseUrl.includes("REPLACE_ME") &&
    !CONFIG.supabaseAnonKey.includes("REPLACE_ME");
}

export function remindersConfigured() {
  return CONFIG.vapidPublicKey.length > 0;
}

export const CLIP_BUCKET = "clips";

export function clipObjectPath(studioId, performerId, logId) {
  return `${studioId}/${performerId}/${logId}`.toLowerCase() + ".m4a";
}
