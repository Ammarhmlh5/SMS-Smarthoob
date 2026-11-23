import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
export const localApiUrl = process.env.EXPO_PUBLIC_LOCAL_API_URL?.trim();

function isValidSupabaseUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export const isSupabaseConfigured =
  isValidSupabaseUrl(supabaseUrl) && Boolean(supabaseAnonKey?.trim());

export const isLocalApiConfigured = isValidSupabaseUrl(localApiUrl);

const clientUrl = isValidSupabaseUrl(localApiUrl)
  ? localApiUrl
  : isSupabaseConfigured && supabaseUrl
    ? supabaseUrl
    : 'https://supabase-not-configured.invalid';
const clientKey = isLocalApiConfigured
  ? 'local-postgres-api-key'
  : isSupabaseConfigured && supabaseAnonKey
    ? supabaseAnonKey
    : 'preview-disabled';

export const supabase = createClient(clientUrl, clientKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
