import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
export const requireUser = cache(async () => {
  const db = await supabaseServer();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) redirect('/login');
  const { data: profile, error: profileError } = await db.from('user_profiles').select('display_name,role,active').eq('user_id', user.id).single();
  if (profileError || !profile?.active) redirect('/login?error=profile');
  return { db, user, profile };
});
