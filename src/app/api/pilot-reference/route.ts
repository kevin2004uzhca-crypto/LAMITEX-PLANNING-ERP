import { requireUser } from '@/lib/auth';
import reference from '@/data/pilot-reference.json';
export async function GET(request: Request) {
  await requireUser();
  const kind = new URL(request.url).searchParams.get('kind') === 'catalog' ? 'catalog' : 'diagram';
  return new Response(Buffer.from(reference.images[kind], 'base64'), { headers: {
    'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
  } });
}
