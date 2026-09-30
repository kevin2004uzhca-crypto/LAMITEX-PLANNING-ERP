'use server';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
export async function login(form: FormData) {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  if (!email || !password) redirect('/login?error=credentials');
  const db = await supabaseServer();
  let failed = false;
  let connectionFailed = false;
  try { const { error } = await db.auth.signInWithPassword({ email, password }); failed = !!error; connectionFailed = !!error && (!error.status || error.status >= 500); }
  catch { redirect('/login?error=connection'); }
  if (connectionFailed) redirect('/login?error=connection');
  if (failed) redirect('/login?error=credentials');
  redirect('/');
}
export async function logout() {
  const db = await supabaseServer();
  await db.auth.signOut();
  redirect('/login');
}
