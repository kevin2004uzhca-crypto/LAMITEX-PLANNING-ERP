import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicConfig } from '@/lib/config';
export async function supabaseServer(timeoutMs = 12000) {
  const jar = await cookies();
  const { url, key } = publicConfig();
  return createServerClient(url, key, { global: {
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(init?.signal ? [init.signal] : [])]) }),
  }, cookies: {
    getAll: () => jar.getAll(),
    setAll: (values) => { try { values.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { /* Server components read refreshed cookies from proxy. */ } },
  } });
}
