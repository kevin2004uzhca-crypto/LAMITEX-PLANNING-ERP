// OneDrive marks generated directories as cloud reparse points. Next's unlink
// cleanup can treat them as links on Windows; PowerShell handles these folders.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = fs.realpathSync(path.resolve(__dirname, '..'));
const target = path.join(root, '.next');
if (process.platform === 'win32' && fs.existsSync(target)) {
  const actual = fs.realpathSync(target);
  if (actual.toLowerCase() !== target.toLowerCase()) {
    throw new Error('La salida .next apunta fuera del proyecto. No se eliminó nada.');
  }
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$target = [IO.Path]::GetFullPath($env:LAMITEX_BUILD_OUTPUT); ' +
    '$root = [IO.Path]::GetFullPath($env:LAMITEX_BUILD_ROOT); ' +
    "if ($target -ne (Join-Path $root '.next')) { throw 'Ruta de build inválida' }; " +
    'Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop'
  ], { env: { ...process.env, LAMITEX_BUILD_OUTPUT: target, LAMITEX_BUILD_ROOT: root }, windowsHide: true, stdio: 'inherit' });
}
