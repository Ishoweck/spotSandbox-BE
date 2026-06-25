import { PDFDocument, rgb, StandardFonts, PDFImage } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

let LOGO_BYTES: Buffer | null = null;
try {
  LOGO_BYTES = fs.readFileSync(path.join(__dirname, '../../public/logo.png'));
} catch { /* no logo — text fallback */ }

const PW = 595;
const PH = 842;
const M  = 44;
const CW = PW - M * 2;

const PINK   = rgb(0.843, 0.000, 0.294);
const DARK   = rgb(0.067, 0.094, 0.153);
const GRAY   = rgb(0.500, 0.500, 0.500);
const LT     = rgb(0.965, 0.965, 0.965);
const WHITE  = rgb(1, 1, 1);
const BORDER = rgb(0.870, 0.870, 0.870);

const trunc = (s: any, n: number) => {
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
};

const fmtMoney = (n: number) =>
  'NGN ' + (n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export interface ReceiptData {
  orderNumber: string;
  date:        Date | string;
  paymentMethod: string;
  paymentReference?: string;
  customer: {
    name:  string;
    email: string;
  };
  deliveryAddress?: {
    street?:  string;
    city?:    string;
    state?:   string;
    country?: string;
  };
  items: {
    productName: string;
    vendorName?: string;
    quantity:    number;
    price:       number;
  }[];
  subtotal:      number;
  discount:      number;
  shippingCost:  number;
  serviceCharge: number;
  total:         number;
}

export async function generateReceiptPDF(data: ReceiptData): Promise<Buffer> {
  const pdf  = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let logoImg: PDFImage | null = null;
  if (LOGO_BYTES) {
    try { logoImg = await pdf.embedPng(LOGO_BYTES); } catch {}
  }

  const page = pdf.addPage([PW, PH]);
  let y = PH - M;

  // ── Logo top-right ────────────────────────────────────────────────────────
  if (logoImg) {
    const LH = 28;
    const LW = Math.round(LH * (logoImg.width / logoImg.height));
    page.drawImage(logoImg, { x: PW - M - LW, y: y - LH, width: LW, height: LH });
    const tag = 'Confidence in every click';
    page.drawText(tag, {
      x: PW - M - font.widthOfTextAtSize(tag, 6),
      y: y - LH - 9,
      size: 6, font, color: GRAY,
    });
  } else {
    const V_SIZE = 15;
    const VW = bold.widthOfTextAtSize('V', V_SIZE);
    page.drawText('V',         { x: PW - M - VW - bold.widthOfTextAtSize('endorspot', V_SIZE), y: y - V_SIZE, size: V_SIZE, font: bold, color: PINK });
    page.drawText('endorspot', { x: PW - M - bold.widthOfTextAtSize('endorspot', V_SIZE),     y: y - V_SIZE, size: V_SIZE, font: bold, color: DARK });
    const tag = 'Confidence in every click';
    page.drawText(tag, {
      x: PW - M - font.widthOfTextAtSize(tag, 6),
      y: y - V_SIZE - 10,
      size: 6, font, color: GRAY,
    });
  }

  // ── Title ─────────────────────────────────────────────────────────────────
  page.drawText('Order Receipt', { x: M, y: y - 22, size: 20, font: bold, color: DARK });
  y -= 38;

  page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.5, color: BORDER });
  y -= 16;

  // ── Order meta + customer info ────────────────────────────────────────────
  const metaLeft: [string, string][] = [
    ['Order Number:', `#${data.orderNumber}`],
    ['Date:',         fmtDate(data.date)],
    ['Payment:',      data.paymentMethod.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())],
    ...(data.paymentReference ? [['Reference:', trunc(data.paymentReference, 30)] as [string, string]] : []),
  ];

  const metaRight: [string, string][] = [
    ['Customer:',  data.customer.name.split(' ')[0]],
  ];

  const metaStartY = y;
  metaLeft.forEach(([label, value], i) => {
    const ry = metaStartY - i * 14;
    page.drawText(label, { x: M,      y: ry, size: 7.5, font: bold, color: DARK });
    page.drawText(value, { x: M + 80, y: ry, size: 7.5, font,       color: DARK });
  });

  metaRight.forEach(([label, value], i) => {
    const ry = metaStartY - i * 14;
    const mid = M + CW / 2 + 10;
    page.drawText(label, { x: mid,      y: ry, size: 7.5, font: bold, color: DARK });
    page.drawText(value, { x: mid + 72, y: ry, size: 7.5, font,       color: DARK });
  });

  y = metaStartY - Math.max(metaLeft.length, metaRight.length) * 14 - 18;

  // ── Items table ───────────────────────────────────────────────────────────
  page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.5, color: BORDER });
  y -= 2;

  // Table header
  const colW = { sn: 24, item: 182, vendor: 100, qty: 36, unit: 80, total: 85 };
  page.drawRectangle({ x: M, y: y - 18, width: CW, height: 18, color: DARK });

  let cx = M;
  const headers = [
    { t: '#',          w: colW.sn,     right: false },
    { t: 'ITEM',       w: colW.item,   right: false },
    { t: 'VENDOR',     w: colW.vendor, right: false },
    { t: 'QTY',        w: colW.qty,    right: true  },
    { t: 'UNIT PRICE', w: colW.unit,   right: true  },
    { t: 'TOTAL',      w: colW.total,  right: true  },
  ];

  for (const h of headers) {
    const tx = h.right ? cx + h.w - 6 - bold.widthOfTextAtSize(h.t, 7) : cx + 5;
    page.drawText(h.t, { x: tx, y: y - 13, size: 7, font: bold, color: WHITE });
    cx += h.w;
  }
  y -= 18;

  data.items.forEach((item, idx) => {
    const rowH = 16;
    const bg   = idx % 2 === 0 ? WHITE : LT;
    page.drawRectangle({ x: M, y: y - rowH, width: CW, height: rowH, color: bg });

    let rx = M;
    const cells = [
      { t: String(idx + 1),                     w: colW.sn,     right: false, color: GRAY },
      { t: trunc(item.productName, 36),          w: colW.item,   right: false, color: DARK },
      { t: trunc(item.vendorName || '—', 20),    w: colW.vendor, right: false, color: GRAY },
      { t: String(item.quantity),                w: colW.qty,    right: true,  color: DARK },
      { t: fmtMoney(item.price),                 w: colW.unit,   right: true,  color: DARK },
      { t: fmtMoney(item.price * item.quantity), w: colW.total,  right: true,  color: DARK },
    ];

    for (const cell of cells) {
      const tx = cell.right
        ? rx + cell.w - 6 - font.widthOfTextAtSize(cell.t, 7.5)
        : rx + 5;
      page.drawText(cell.t, { x: tx, y: y - 11, size: 7.5, font, color: cell.color });
      rx += cell.w;
    }
    y -= rowH;
  });

  // ── Totals block ──────────────────────────────────────────────────────────
  y -= 12;
  page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.5, color: BORDER });
  y -= 14;

  const totRows: [string, string, boolean][] = [
    ['Subtotal',       fmtMoney(data.subtotal),      false],
    ...(data.discount > 0 ? [['Discount', `- ${fmtMoney(data.discount)}`, false] as [string, string, boolean]] : []),
    ['Shipping',       fmtMoney(data.shippingCost),  false],
    ['Service Charge', fmtMoney(data.serviceCharge), false],
  ];

  const totX    = PW - M - 200;
  const valXEnd = PW - M;

  for (const [label, value, _bold] of totRows) {
    page.drawText(label, { x: totX, y, size: 8, font, color: GRAY });
    page.drawText(value, { x: valXEnd - font.widthOfTextAtSize(value, 8), y, size: 8, font, color: DARK });
    y -= 14;
  }

  // Grand total box
  page.drawRectangle({ x: totX - 8, y: y - 6, width: valXEnd - totX + 8, height: 26, color: LT, borderColor: BORDER, borderWidth: 0.5 });
  const totalLabel = 'Total';
  const totalValue = fmtMoney(data.total);
  page.drawText(totalLabel, { x: totX, y: y + 7, size: 9, font: bold, color: DARK });
  page.drawText(totalValue, { x: valXEnd - bold.widthOfTextAtSize(totalValue, 11), y: y + 5, size: 11, font: bold, color: DARK });
  y -= 24;

  // ── Footer ────────────────────────────────────────────────────────────────
  y -= 20;
  page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 1, color: rgb(0.4, 0.4, 0.4) });
  y -= 13;
  page.drawText('Thank you for shopping with Vendorspot!', { x: M, y, size: 8, font: bold, color: DARK });
  y -= 11;
  page.drawText('For support: support@vendorspotng.com  ·  vendorspotng.com', { x: M, y, size: 7, font, color: GRAY });

  // Page number
  page.drawText('Page 1 of 1', { x: PW - M - 45, y: 22, size: 6.5, font, color: GRAY });

  return Buffer.from(await pdf.save());
}
