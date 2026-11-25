import { createClient } from "@supabase/supabase-js";
import { projectId, publicAnonKey } from "../../utils/supabase/info";

const configuredUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const configuredKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabaseUrl = configuredUrl || (projectId ? `https://${projectId}.supabase.co` : "");
export const supabaseKey = configuredKey || publicAnonKey;
export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseKey);

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "diane-auth",
  },
});
