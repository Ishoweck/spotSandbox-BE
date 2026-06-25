import { PDFDocument, rgb, StandardFonts, PDFImage } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

let LOGO_BYTES: Buffer | null = null;
try { LOGO_BYTES = fs.readFileSync(path.join(__dirname, '../../public/logo.png')); } catch {}

const PW = 595, PH = 842, M = 40, CW = PW - M * 2;
const PINK   = rgb(0.843, 0.000, 0.294);
const DARK   = rgb(0.067, 0.094, 0.153);
const GRAY   = rgb(0.500, 0.500, 0.500);
const LT     = rgb(0.965, 0.965, 0.965);
const WHITE  = rgb(1, 1, 1);
const BORDER = rgb(0.870, 0.870, 0.870);
const GREEN  = rgb(0.063, 0.725, 0.506);
const RED    = rgb(0.937, 0.267, 0.267);
const AMBER  = rgb(0.900, 0.550, 0.050);

const fmtMoney = (n: number) => 'NGN ' + (n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate  = (d: any)    => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const cap      = (s: string) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const trunc    = (s: any, n: number) => { const str = String(s ?? ''); return str.length > n ? str.slice(0, n - 1) + '…' : str; };

function statusColor(s: string) {
  if (s === 'paid')    return GREEN;
  if (s === 'overdue') return RED;
  return AMBER;
}

export async function generateExpensePDF(
  expenses: any[],
  opts: { startDate?: Date; endDate?: Date } = {},
): Promise<Buffer> {
  const pdf  = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let logoImg: PDFImage | null = null;
  if (LOGO_BYTES) { try { logoImg = await pdf.embedPng(LOGO_BYTES); } catch {} }

  const cur: { pg: any; y: number } = { pg: null, y: 0 };

  function newPage(cont = false) {
    cur.pg = pdf.addPage([PW, PH]);
    if (cont) {
      cur.pg.drawLine({ start: { x: M, y: PH - 30 }, end: { x: PW - M, y: PH - 30 }, thickness: 1, color: PINK });
      cur.pg.drawText('Vendorspot · Company Expense Report (continued)', { x: M, y: PH - 22, size: 7.5, font, color: GRAY });
      cur.y = PH - 55;
    } else {
      cur.y = PH;
    }
  }

  function need(h: number) { if (cur.y - h < M + 40) newPage(true); }

  newPage(false);

  // Logo top-right
  const logoTop = PH - M;
  if (logoImg) {
    const LH = 28, LW = Math.round(LH * (logoImg.width / logoImg.height));
    cur.pg.drawImage(logoImg, { x: PW - M - LW, y: logoTop - LH, width: LW, height: LH });
    const tag = 'Confidence in every click';
    cur.pg.drawText(tag, { x: PW - M - font.widthOfTextAtSize(tag, 6), y: logoTop - LH - 9, size: 6, font, color: GRAY });
  } else {
    const V_SIZE = 15;
    const VW = bold.widthOfTextAtSize('V', V_SIZE);
    cur.pg.drawText('V',         { x: PW - M - VW - bold.widthOfTextAtSize('endorspot', V_SIZE), y: logoTop - V_SIZE, size: V_SIZE, font: bold, color: PINK });
    cur.pg.drawText('endorspot', { x: PW - M - bold.widthOfTextAtSize('endorspot', V_SIZE),     y: logoTop - V_SIZE, size: V_SIZE, font: bold, color: DARK });
  }

  // Title
  cur.pg.drawText('Company Expense Report', { x: M, y: logoTop - 22, size: 20, font: bold, color: DARK });
  cur.y = logoTop - 38;
  cur.pg.drawLine({ start: { x: M, y: cur.y }, end: { x: PW - M, y: cur.y }, thickness: 0.5, color: BORDER });
  cur.y -= 14;

  // Period
  const periodStr = opts.startDate || opts.endDate
    ? `Period: ${fmtDate(opts.startDate)} – ${fmtDate(opts.endDate)}`
    : `Generated: ${fmtDate(new Date())}`;
  cur.pg.drawText(periodStr, { x: M, y: cur.y, size: 8, font, color: GRAY });
  cur.y -= 22;

  // Summary cards
  const totalPaid    = expenses.filter(e => e.status === 'paid').reduce((s, e) => s + e.amount, 0);
  const totalPending = expenses.filter(e => e.status === 'pending').reduce((s, e) => s + e.amount, 0);
  const totalOverdue = expenses.filter(e => e.status === 'overdue').reduce((s, e) => s + e.amount, 0);

  const cards = [
    { label: 'Total Paid',    value: fmtMoney(totalPaid),    color: GREEN },
    { label: 'Pending',       value: fmtMoney(totalPending), color: AMBER },
    { label: 'Overdue',       value: fmtMoney(totalOverdue), color: RED   },
    { label: 'Total Records', value: String(expenses.length), color: DARK  },
  ];
  const cW4 = CW / 4;
  cur.pg.drawRectangle({ x: M, y: cur.y - 50, width: CW, height: 50, color: LT, borderColor: BORDER, borderWidth: 0.75 });
  cards.forEach((card, i) => {
    const cx = M + i * cW4;
    if (i > 0) cur.pg.drawLine({ start: { x: cx, y: cur.y }, end: { x: cx, y: cur.y - 50 }, thickness: 0.5, color: BORDER });
    cur.pg.drawText(card.label, { x: cx + 10, y: cur.y - 14, size: 7,  font: bold, color: DARK });
    cur.pg.drawText(trunc(card.value, 18), { x: cx + 10, y: cur.y - 38, size: 10, font: bold, color: card.color });
  });
  cur.y -= 66;

  // Table
  const cols = [
    { h: 'REF',       w: 70  },
    { h: 'TITLE',     w: 130 },
    { h: 'CATEGORY',  w: 80  },
    { h: 'VENDOR',    w: 75  },
    { h: 'AMOUNT',    w: 85, right: true },
    { h: 'STATUS',    w: 60  },
    { h: 'DATE',      w: 75  },
  ];

  // Header
  need(20);
  cur.pg.drawRectangle({ x: M, y: cur.y - 18, width: CW, height: 18, color: DARK });
  let hx = M;
  for (const col of cols) {
    cur.pg.drawText(col.h, { x: hx + 5, y: cur.y - 13, size: 7, font: bold, color: WHITE });
    hx += col.w;
  }
  cur.y -= 18;

  expenses.forEach((exp, idx) => {
    need(16);
    const bg = idx % 2 === 0 ? WHITE : LT;
    cur.pg.drawRectangle({ x: M, y: cur.y - 15, width: CW, height: 15, color: bg });

    const vals = [
      trunc(exp.expenseRef, 12),
      trunc(exp.title, 24),
      cap(exp.category),
      trunc(exp.vendor || '—', 14),
      fmtMoney(exp.amount),
      cap(exp.status),
      fmtDate(exp.paidAt || exp.createdAt),
    ];
    const colors = [GRAY, DARK, GRAY, GRAY, DARK, statusColor(exp.status), GRAY];

    let cx = M;
    cols.forEach((col, i) => {
      const tx = col.right
        ? cx + col.w - 6 - font.widthOfTextAtSize(vals[i], 7)
        : cx + 5;
      cur.pg.drawText(vals[i], { x: tx, y: cur.y - 10.5, size: 7, font, color: colors[i] });
      cx += col.w;
    });
    cur.y -= 15;
  });

  // Footer
  need(36);
  cur.y -= 18;
  cur.pg.drawLine({ start: { x: M, y: cur.y }, end: { x: PW - M, y: cur.y }, thickness: 0.75, color: rgb(0.4, 0.4, 0.4) });
  cur.y -= 13;
  cur.pg.drawText(
    `This report was generated by Vendorspot on ${fmtDate(new Date())}. Confidential — Internal Use Only.`,
    { x: M, y: cur.y, size: 7, font, color: GRAY },
  );

  const pageCount = pdf.getPageCount();
  for (let p = 0; p < pageCount; p++) {
    pdf.getPage(p).drawText(`Page ${p + 1} of ${pageCount}`, { x: PW - M - 55, y: 22, size: 7, font, color: GRAY });
  }

  return Buffer.from(await pdf.save());
}

export function generateExpenseCSV(expenses: any[]): string {
  const headers = ['Ref','Title','Category','Vendor','Amount','Currency','Status','Due Date','Paid At','Recurring','Interval','Tags','Notes','Created At'];
  const rows = expenses.map(e => [
    e.expenseRef        ?? '',
    `"${(e.title        ?? '').replace(/"/g, '""')}"`,
    e.category          ?? '',
    `"${(e.vendor       ?? '').replace(/"/g, '""')}"`,
    e.amount            ?? 0,
    e.currency          ?? 'NGN',
    e.status            ?? '',
    e.dueDate ? new Date(e.dueDate).toISOString().split('T')[0] : '',
    e.paidAt  ? new Date(e.paidAt ).toISOString().split('T')[0] : '',
    e.isRecurring ? 'Yes' : 'No',
    e.recurringInterval ?? '',
    `"${(e.tags         ?? []).join(', ')}"`,
    `"${(e.notes        ?? '').replace(/"/g, '""')}"`,
    new Date(e.createdAt).toISOString().split('T')[0],
  ]);
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}
