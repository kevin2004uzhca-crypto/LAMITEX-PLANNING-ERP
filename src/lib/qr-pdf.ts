import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';

export type PdfLabel = { code: string; seq: number; lineTotal: number; sap_code: string; model_name: string; measure: string | null; observation: string | null };
export type PdfBatch = { id: number; programmer: string; created_at: string; width_mm: number; height_mm: number };

const MM = 72 / 25.4;
const ink = rgb(0, 0, 0);
// Las fuentes estándar del PDF solo codifican Latin-1: se reemplaza lo que no se pueda imprimir.
const clean = (s: string) => s.normalize('NFC').replace(/[^\x20-\x7E -ÿ]/g, '-');

function fitSize(text: string, font: PDFFont, maxWidth: number, max: number, min: number) {
  let size = max;
  while (size > min && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.25;
  return size;
}
/** Parte el texto en un máximo de `lines` renglones del ancho dado, con el tamaño más grande que quepa. */
function wrap(text: string, font: PDFFont, maxWidth: number, max: number, min: number, lines: number) {
  for (let size = max; size >= min; size -= 0.25) {
    const words = text.split(/\s+/); const out: string[] = []; let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) cur = next; else { if (cur) out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    if (out.length <= lines && out.every(l => font.widthOfTextAtSize(l, size) <= maxWidth)) return { size, lines: out };
  }
  // No cupo ni con la letra mínima: se recorta el último renglón.
  const size = min; const out: string[] = []; let rest = text;
  for (let i = 0; i < lines && rest; i++) {
    let cut = rest.length;
    while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
    out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
  }
  return { size, lines: out };
}

/** Dibuja el QR como cuadros vectoriales: queda nítido en cualquier impresora térmica. */
function drawQr(page: PDFPage, text: string, x: number, y: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size; const quiet = 2; const cell = size / (n + quiet * 2);
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(r, c)) { c++; continue; }
      let run = 1; while (c + run < n && qr.modules.get(r, c + run)) run++;
      page.drawRectangle({ x: x + (quiet + c) * cell, y: y + size - (quiet + r + 1) * cell, width: run * cell + 0.01, height: cell + 0.01, color: ink });
      c += run;
    }
  }
}

export async function labelsPdf(batch: PdfBatch, labels: PdfLabel[]) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Etiquetas QR lote ${batch.id}`); doc.setAuthor('LAMITEX'); doc.setCreator('LAMITEX Planning ERP');
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const W = batch.width_mm * MM, H = batch.height_mm * MM;
  const pad = Math.max(1.5 * MM, Math.min(W, H) * 0.05);
  const date = new Date(batch.created_at).toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil' });
  const landscape = W >= H * 1.25;

  for (const l of labels) {
    const page = doc.addPage([W, H]);
    const model = clean(l.model_name.toUpperCase());
    const details = [
      l.measure ? clean(l.measure) : null,
      `SAP ${clean(l.sap_code)}`,
    ].filter(Boolean).join('  ·  ');
    const footer = clean(`${l.code}   ${l.seq}/${l.lineTotal}   Lote ${batch.id}   ${date}`);
    const note = l.observation ? clean(l.observation) : null;

    if (landscape) {
      const qrSize = Math.min(H - pad * 2, W * 0.46);
      drawQr(page, l.code, pad, (H - qrSize) / 2, qrSize);
      const tx = pad + qrSize + pad * 0.6, tw = W - tx - pad;
      const name = wrap(model, bold, tw, H * 0.2, 6, 3);
      let y = H - pad - name.size;
      for (const line of name.lines) { page.drawText(line, { x: tx, y, size: name.size, font: bold, color: ink }); y -= name.size * 1.12; }
      const ds = fitSize(details, regular, tw, H * 0.11, 5);
      y -= ds * 0.35; page.drawText(details, { x: tx, y, size: ds, font: regular, color: ink });
      if (note) { const ns = fitSize(note, regular, tw, H * 0.08, 4.5); y -= ns * 1.5; page.drawText(note, { x: tx, y, size: ns, font: regular, color: ink }); }
      const codeSize = fitSize(l.code, bold, tw, H * 0.1, 5);
      const rest = clean(`${l.seq}/${l.lineTotal}  ·  Lote ${batch.id}  ·  ${date}`);
      const rs = fitSize(rest, regular, tw, H * 0.075, 4);
      page.drawText(rest, { x: tx, y: pad, size: rs, font: regular, color: ink });
      page.drawText(l.code, { x: tx, y: pad + rs * 1.35, size: codeSize, font: bold, color: ink });
    } else {
      const fs = fitSize(footer, regular, W - pad * 2, H * 0.045, 4);
      const name = wrap(model, bold, W - pad * 2, H * 0.09, 5, 2);
      const ds = fitSize(details, regular, W - pad * 2, H * 0.055, 4.5);
      const textH = name.lines.length * name.size * 1.12 + ds * 1.4 + fs * 1.6;
      const qrSize = Math.min(W - pad * 2, H - pad * 2 - textH);
      drawQr(page, l.code, (W - qrSize) / 2, H - pad - qrSize, qrSize);
      let y = H - pad - qrSize - name.size;
      for (const line of name.lines) { page.drawText(line, { x: (W - bold.widthOfTextAtSize(line, name.size)) / 2, y, size: name.size, font: bold, color: ink }); y -= name.size * 1.12; }
      page.drawText(details, { x: (W - regular.widthOfTextAtSize(details, ds)) / 2, y: y - ds * 0.2, size: ds, font: regular, color: ink });
      page.drawText(footer, { x: (W - regular.widthOfTextAtSize(footer, fs)) / 2, y: pad, size: fs, font: regular, color: ink });
    }
  }
  return Buffer.from(await doc.save());
}
