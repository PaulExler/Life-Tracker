import { createClient } from '@supabase/supabase-js'

// The project URL and publishable key are meant to be public; Row Level Security
// in the database (supabase/01_core.sql) is what keeps the data private.
const SUPABASE_URL = 'https://isqptchyivpbbwjiwtfd.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bLe1r_Yqo7mP6BMPV1vkLQ_fpO2zEIy'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
