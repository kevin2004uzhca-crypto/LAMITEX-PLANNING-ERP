'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
export function SourceUpload(){
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const router=useRouter();
  return <form onSubmit={async e=>{e.preventDefault();setBusy(true);setMessage('Archivando fuente…');try{const form=new FormData(e.currentTarget);const response=await fetch('/api/imports/source',{method:'POST',body:form});const result=await response.json();setMessage(result.error??result.message);if(response.ok)router.refresh();}catch{setMessage('No se pudo completar la carga. Revisa la conexión e inténtalo otra vez.');}finally{setBusy(false);}}}><label>Archivo original del piloto<input type="file" name="file" accept=".xlsx" required disabled={busy}/></label><p><button className="primary" disabled={busy}>{busy?'Archivando…':'Archivar fuente original'}</button></p><p role="status">{message}</p></form>;
}
