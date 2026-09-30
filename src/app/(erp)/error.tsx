'use client';
export default function ErrorPage({ reset }: { reset: () => void }) { return <section className="panel"><h1>No se pudo cargar esta vista</h1><p>Comprueba tu conexión. Si el problema continúa, revisa el estado del sistema o contacta al administrador.</p><button onClick={reset}>Volver a intentar</button></section>; }
