export const supabaseConfig = {
  url: "https://pmsjpsqkzwifajgedhil.supabase.co",
  anonKey: "sb_publishable_EQlNManlysju-w7StrU66w_faXbHm1u",
  table: "licenses"
};

export function isSupabaseConfigured() {
  return supabaseConfig.url.startsWith("https://") && supabaseConfig.anonKey.length > 20;
}
