import { checkOrigin,persistEngineering,apiError } from '@/lib/engineering-api';
export async function POST(request:Request){try{checkOrigin(request);const body=await request.json();const saved=await persistEngineering(body.boms,body.acknowledged===true);return Response.json({saved});}catch(e){return apiError(e);}}
