'use client';
import { useEffect, useRef, useState } from 'react';

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/**
 * Lector QR con la cámara trasera del celular. Usa el lector nativo del navegador cuando existe
 * (Chrome/Android) y jsQR en los demás (Safari/iPhone). Requiere HTTPS o localhost.
 */
export function QrCamera({ onCode, paused }: { onCode: (text: string) => void; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const cb = useRef(onCode); cb.current = onCode;
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const [error, setError] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null, stop = false, timer = 0;
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('La cámara solo funciona con HTTPS (o en localhost). Usa el ingreso manual o abre el sistema por su enlace seguro.'); return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (e) {
        setError(e instanceof Error && e.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Actívalo en el navegador y vuelve a intentar.' : 'No se pudo abrir la cámara de este dispositivo.'); return;
      }
      if (stop) { stream.getTracks().forEach(t => t.stop()); return; }
      const v = video.current!; v.srcObject = stream; await v.play().catch(() => {});
      let detector: Detector | null = null;
      const BD = (window as any).BarcodeDetector;
      if (BD) { try { if ((await BD.getSupportedFormats()).includes('qr_code')) detector = new BD({ formats: ['qr_code'] }); } catch { /* usa jsQR */ } }
      const jsQR = detector ? null : (await import('jsqr')).default;
      const tick = async () => {
        if (stop) return;
        if (!pausedRef.current && v.readyState >= 2 && v.videoWidth) {
          try {
            let text: string | null = null;
            if (detector) text = (await detector.detect(v))[0]?.rawValue ?? null;
            else if (jsQR && ctx) {
              const scale = Math.min(1, 800 / v.videoWidth);
              canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale);
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
            }
            if (text) cb.current(text);
          } catch { /* cuadro ilegible: se intenta con el siguiente */ }
        }
        timer = window.setTimeout(tick, 180);
      };
      tick();
    })();
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); };
  }, []);

  if (error) return <p className="alert error" role="alert">{error}</p>;
  return <div className="qr-camera"><video ref={video} playsInline muted/><div className="qr-frame" aria-hidden="true"/></div>;
}
