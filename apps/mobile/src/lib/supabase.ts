import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

// Same Supabase project as apps/web (CLAUDE.md §6.12) — this app is a
// second client against the same Auth/Postgres/Storage backend, not a
// separate account system. AsyncStorage replaces apps/web's cookie-based
// @supabase/ssr session handling, which is Next.js-specific and doesn't
// apply here.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
