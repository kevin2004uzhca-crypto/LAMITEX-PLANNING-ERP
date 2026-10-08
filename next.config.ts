import type { NextConfig } from 'next';
const config: NextConfig = {
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  poweredByHeader: false,
  serverExternalPackages: ['highs'],
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      // Solo HTTPS en el navegador (Railway). En http://localhost el navegador lo ignora.
      { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
      // La cámara solo para este sitio (lector QR); micrófono y ubicación apagados.
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
    ] }];
  },
};
export default config;
