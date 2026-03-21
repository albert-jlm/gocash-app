import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Scoped to the 'gocash' schema — all queries target gocash.* tables
export const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    db: { schema: "gocash" },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
