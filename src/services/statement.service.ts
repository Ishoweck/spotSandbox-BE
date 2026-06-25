import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont, Color, PDFImage } from 'pdf-lib';
import { Types } from 'mongoose';
import fs from 'fs';
import path from 'path';
import Order from '../models/Order';
import Wallet from '../models/Wallet';
import Dispute from '../models/Dispute';
import VendorProfile from '../models/VendorProfile';
import User from '../models/User';
import { logger } from '../utils/logger';

// Load logo once at module level
let LOGO_BYTES: Buffer | null = null;
try {
  LOGO_BYTES = fs.readFileSync(path.join(__dirname, '../../public/logo.png'));
} catch {
  // logo not found — fallback to text mark
}

// ─── Layout Constants ────────────────────────────────────────────────────────
const PW = 595;
const PH = 842;
const M  = 40;
const CW = PW - M * 2;

// ─── Colours ─────────────────────────────────────────────────────────────────
const PINK    = rgb(0.843, 0.000, 0.294);  // brand #d7004b
const DARK    = rgb(0.067, 0.094, 0.153);
const GRAY    = rgb(0.500, 0.500, 0.500);
const LT_GRAY = rgb(0.965, 0.965, 0.965);
const WHITE   = rgb(1, 1, 1);
const GREEN   = rgb(0.063, 0.725, 0.506);
const RED     = rgb(0.937, 0.267, 0.267);
const AMBER   = rgb(0.900, 0.550, 0.050);
const BORDER  = rgb(0.870, 0.870, 0.870);

// ─── Utilities ───────────────────────────────────────────────────────────────
const trunc = (s: any, n: number): string => {
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
};

const fmtMoney = (n: number) =>
  'NGN ' + (n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const cap = (s: string) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function statusColour(status: string): Color {
  const s = (status || '').toLowerCase();
  if (['delivered', 'completed', 'resolved_full_refund', 'resolved_partial_refund', 'credit', 'close', 'confirmed'].includes(s)) return GREEN;
  if (['cancelled', 'rejected', 'failed', 'debit', 'canceled', 'open'].includes(s)) return RED;
  if (['pending', 'under_review', 'processing'].includes(s)) return AMBER;
  return GRAY;
}

// ─── Types ───────────────────────────────────────────────────────────────────
export interface StatementData {
  vendor: { name: string; email: string; storeName: string; location: string };
  period: { start: Date; end: Date };
  summary: {
    totalRevenue:    number;
    earnedRevenue:   number;
    totalOrders:     number;
    totalItems:      number;
    walletBalance:   number;
    pendingBalance:  number;
    totalWithdrawn:  number;
  };
  orders: {
    orderNumber:  string;
    date:         Date;
    customer:     string;
    vendorAmount: number;
    status:       string;
    itemCount:    number;
  }[];
  txns: {
    date:        Date;
    type:        string;
    purpose:     string;
    amount:      number;
    description: string;
  }[];
  disputes: {
    disputeNumber: string;
    date:          Date;
    orderNumber:   string;
    reason:        string;
    status:        string;
    refundAmount?: number;
  }[];
}

// ─── Data Gathering ──────────────────────────────────────────────────────────
export async function gatherStatementData(
  vendorId: string,
  startDate: Date,
  endDate: Date,
): Promise<StatementData> {
  const vid = new Types.ObjectId(vendorId);
  startDate.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const [vendorUser, vendorProfile, rawOrders, wallet, disputes] = await Promise.all([
    User.findById(vid).select('firstName lastName email').lean(),
    VendorProfile.findOne({ user: vid }).select('businessName businessAddress').lean(),
    Order.find({
      'vendorShipments.vendor': vid,
      createdAt: { $gte: startDate, $lte: end },
    }).populate('user', 'firstName lastName').lean(),
    Wallet.findOne({ user: vid }).lean(),
    Dispute.find({ vendor: vid, createdAt: { $gte: startDate, $lte: end } }).lean(),
  ]);

  let totalRevenue  = 0;
  let earnedRevenue = 0;
  let totalItems    = 0;
  const FULFILLED = new Set(['delivered', 'completed']);

  const orders = (rawOrders as any[]).map(o => {
    const myItems = (o.items || []).filter(
      (it: any) => (it.vendor?._id || it.vendor)?.toString() === vendorId,
    );
    const vendorAmount = myItems.reduce(
      (s: number, it: any) => s + (it.price || 0) * (it.quantity || 1), 0,
    );
    const qtyCount = myItems.reduce((s: number, it: any) => s + (it.quantity || 1), 0);

    totalRevenue += vendorAmount;
    totalItems   += qtyCount;
    if (FULFILLED.has((o.status || '').toLowerCase())) earnedRevenue += vendorAmount;

    const customer = o.user
      ? `${(o.user as any).firstName || ''} ${(o.user as any).lastName || ''}`.trim()
      : 'Customer';

    return {
      orderNumber:  o.orderNumber || '',
      date:         o.createdAt,
      customer:     customer || 'Customer',
      vendorAmount,
      status:       o.status || 'pending',
      itemCount:    qtyCount,
    };
  });

  const txns = ((wallet as any)?.transactions || [])
    .filter((t: any) => {
      const ts = new Date(t.timestamp || t.createdAt);
      return !isNaN(ts.getTime()) && ts >= startDate && ts <= end;
    })
    .map((t: any) => ({
      date:        new Date(t.timestamp || t.createdAt),
      type:        t.type        || '',
      purpose:     t.purpose     || '',
      amount:      Number(t.amount) || 0,
      description: t.description || t.reference || '',
    }));

  const name = vendorUser
    ? `${(vendorUser as any).firstName || ''} ${(vendorUser as any).lastName || ''}`.trim()
    : 'Vendor';

  const addr = (vendorProfile as any)?.businessAddress;
  const location = addr
    ? [addr.city, addr.state].filter(Boolean).join(', ')
    : '';

  return {
    vendor: {
      name,
      email:     (vendorUser as any)?.email || '',
      storeName: (vendorProfile as any)?.businessName || name,
      location,
    },
    period:  { start: startDate, end },
    summary: {
      totalRevenue,
      earnedRevenue,
      totalOrders:   orders.length,
      totalItems,
      walletBalance:  (wallet as any)?.balance        || 0,
      pendingBalance: (wallet as any)?.pendingBalance  || 0,
      totalWithdrawn: (wallet as any)?.totalWithdrawn  || 0,
    },
    orders,
    txns,
    disputes: (disputes as any[]).map(d => ({
      disputeNumber: d.disputeNumber || '',
      date:          d.createdAt,
      orderNumber:   d.orderNumber   || '',
      reason:        d.reason        || '',
      status:        d.status        || '',
      refundAmount:  d.refundAmount,
    })),
  };
}

// ─── PDF Generation ──────────────────────────────────────────────────────────
export async function generateStatementPDF(data: StatementData): Promise<Buffer> {
  const pdf  = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let logoImg: PDFImage | null = null;
  if (LOGO_BYTES) {
    try { logoImg = await pdf.embedPng(LOGO_BYTES); } catch {}
  }

  const cur: { pg: PDFPage; y: number } = { pg: null as any, y: 0 };

  function newPage(continuation = false) {
    cur.pg = pdf.addPage([PW, PH]);
    if (continuation) {
      // Minimal header bar on continuation pages
      cur.pg.drawLine({
        start: { x: M, y: PH - 30 },
        end:   { x: PW - M, y: PH - 30 },
        thickness: 1,
        color: PINK,
      });
      cur.pg.drawText('Vendorspot  ·  Account Statement (continued)', {
        x: M, y: PH - 22, size: 7.5, font, color: GRAY,
      });
      cur.y = PH - 55;
    } else {
      cur.y = PH;
    }
  }

  function need(h: number) {
    if (cur.y - h < M + 40) newPage(true);
  }

  // ── Page 1 ───────────────────────────────────────────────────────────────
  newPage(false);

  // ── Logo — top right ─────────────────────────────────────────────────────
  const logoTop = PH - M;
  if (logoImg) {
    const LH = 30;
    const LW = Math.round(LH * (logoImg.width / logoImg.height));
    cur.pg.drawImage(logoImg, { x: PW - M - LW, y: logoTop - LH, width: LW, height: LH });
    const tagline = 'Confidence in every click';
    cur.pg.drawText(tagline, {
      x: PW - M - font.widthOfTextAtSize(tagline, 6.5),
      y: logoTop - LH - 10,
      size: 6.5, font, color: GRAY,
    });
  } else {
    // Inline "V" pink + "endorspot" dark
    const V_SIZE = 17;
    const VW = bold.widthOfTextAtSize('V', V_SIZE);
    const REST = 'endorspot';
    const restW = bold.widthOfTextAtSize(REST, V_SIZE);
    const totalW = VW + restW;
    const lx = PW - M - totalW;
    cur.pg.drawText('V',    { x: lx,      y: logoTop - V_SIZE, size: V_SIZE, font: bold, color: PINK });
    cur.pg.drawText(REST,   { x: lx + VW, y: logoTop - V_SIZE, size: V_SIZE, font: bold, color: DARK });
    const tagline = 'Confidence in every click';
    cur.pg.drawText(tagline, {
      x: PW - M - font.widthOfTextAtSize(tagline, 6.5),
      y: logoTop - V_SIZE - 11,
      size: 6.5, font, color: GRAY,
    });
  }

  // ── "Account Statement" title ─────────────────────────────────────────────
  cur.y = logoTop - 14;
  cur.pg.drawText('Account Statement', { x: M, y: cur.y - 22, size: 22, font: bold, color: DARK });
  cur.y -= 38;

  // Thin separator
  cur.pg.drawLine({
    start: { x: M, y: cur.y },
    end:   { x: PW - M, y: cur.y },
    thickness: 0.5, color: BORDER,
  });
  cur.y -= 18;

  // ── Info section ──────────────────────────────────────────────────────────
  const infoStartY = cur.y;
  const labelX = M;
  const valueX = M + 95;
  const infoRows = [
    ['Business Name:', trunc(data.vendor.storeName, 30)],
    ['Holder Name:',   data.vendor.name],
    ['Location:',      data.vendor.location || '—'],
    ['Email:',         data.vendor.email],
  ];

  infoRows.forEach(([label, value], i) => {
    const rowY = infoStartY - i * 15;
    cur.pg.drawText(label, { x: labelX, y: rowY, size: 8, font: bold, color: DARK });
    cur.pg.drawText(value, { x: valueX, y: rowY, size: 8, font,       color: DARK });
  });

  // Right side: store name in pink + period
  const storeName = trunc(data.vendor.storeName, 28);
  const storeW = bold.widthOfTextAtSize(storeName, 13);
  cur.pg.drawText(storeName, {
    x: PW - M - storeW,
    y: infoStartY,
    size: 13, font: bold, color: PINK,
  });
  const periodStr = `Period: ${fmtDate(data.period.start)} - ${fmtDate(data.period.end)}`;
  cur.pg.drawText(periodStr, {
    x: PW - M - font.widthOfTextAtSize(periodStr, 7.5),
    y: infoStartY - 17,
    size: 7.5, font, color: GRAY,
  });

  cur.y = infoStartY - infoRows.length * 15 - 20;

  // ── Summary Box ───────────────────────────────────────────────────────────
  const cW3   = CW / 3;
  const rowH  = 62;
  const boxH  = rowH * 2;

  cur.pg.drawRectangle({
    x: M, y: cur.y - boxH,
    width: CW, height: boxH,
    color: LT_GRAY,
    borderColor: BORDER,
    borderWidth: 0.75,
  });

  type SummaryCard = { label: string; sub: string; value: string; color: Color };
  const row1: SummaryCard[] = [
    { label: 'Gross Sales (Period)', sub: 'all orders',      value: fmtMoney(data.summary.totalRevenue),   color: DARK  },
    { label: 'Earned Revenue',       sub: 'delivered only',  value: fmtMoney(data.summary.earnedRevenue),  color: DARK  },
    { label: 'Total Orders',         sub: 'in period',       value: String(data.summary.totalOrders),       color: DARK  },
  ];
  const row2: SummaryCard[] = [
    { label: 'Wallet Balance',       sub: 'available now',   value: fmtMoney(data.summary.walletBalance),  color: GREEN },
    { label: 'Pending Balance',      sub: 'pending release', value: fmtMoney(data.summary.pendingBalance), color: AMBER },
    { label: 'Items (All Orders)',   sub: 'units in period', value: String(data.summary.totalItems),        color: DARK  },
  ];

  const drawSummaryRow = (cards: SummaryCard[], rowTopY: number, drawDivider: boolean) => {
    cards.forEach((card, i) => {
      const cx = M + i * cW3;
      if (i > 0) {
        cur.pg.drawLine({
          start: { x: cx, y: rowTopY },
          end:   { x: cx, y: rowTopY - rowH },
          thickness: 0.5, color: BORDER,
        });
      }
      cur.pg.drawText(card.label, { x: cx + 10, y: rowTopY - 16, size: 7,    font: bold, color: DARK });
      cur.pg.drawText(card.sub,   { x: cx + 10, y: rowTopY - 27, size: 6.5,  font,       color: GRAY });
      cur.pg.drawText(trunc(card.value, 20), { x: cx + 10, y: rowTopY - 50, size: 11, font: bold, color: card.color });
    });
    if (drawDivider) {
      cur.pg.drawLine({
        start: { x: M, y: rowTopY - rowH },
        end:   { x: PW - M, y: rowTopY - rowH },
        thickness: 0.5, color: BORDER,
      });
    }
  };

  const row1Top = cur.y - 0;
  drawSummaryRow(row1, row1Top, true);
  drawSummaryRow(row2, row1Top - rowH, false);

  cur.y -= boxH + 28;

  // ── Table helpers ─────────────────────────────────────────────────────────
  type Col = { h: string; w: number; right?: boolean };

  function sectionTitle(title: string, count: number) {
    need(28);
    cur.pg.drawText(`${title} - ${count}`, {
      x: M, y: cur.y - 16, size: 9.5, font: bold, color: DARK,
    });
    cur.y -= 18;
    cur.pg.drawLine({
      start: { x: M, y: cur.y },
      end:   { x: PW - M, y: cur.y },
      thickness: 0.5, color: BORDER,
    });
    cur.y -= 4;
  }

  function tableHeader(cols: Col[]) {
    need(20);
    cur.pg.drawRectangle({ x: M, y: cur.y - 18, width: CW, height: 18, color: DARK });
    let cx = M;
    for (const col of cols) {
      cur.pg.drawText(col.h, { x: cx + 5, y: cur.y - 13, size: 7.5, font: bold, color: WHITE });
      cx += col.w;
    }
    cur.y -= 18;
  }

  function tableRow(cols: Col[], vals: string[], idx: number, colours?: (Color | null)[]) {
    need(17);
    const bg = idx % 2 === 0 ? WHITE : LT_GRAY;
    cur.pg.drawRectangle({ x: M, y: cur.y - 15, width: CW, height: 15, color: bg });
    let cx = M;
    cols.forEach((col, i) => {
      const raw = trunc(vals[i] ?? '', Math.floor(col.w / 5.2));
      const colColor = colours?.[i] ?? DARK;
      const tx = col.right
        ? cx + col.w - 6 - font.widthOfTextAtSize(raw, 7.5)
        : cx + 5;
      cur.pg.drawText(raw, { x: tx, y: cur.y - 11, size: 7.5, font, color: colColor });
      cx += col.w;
    });
    cur.y -= 15;
  }

  function noData(msg: string) {
    need(24);
    cur.pg.drawRectangle({ x: M, y: cur.y - 20, width: CW, height: 20, color: LT_GRAY });
    cur.pg.drawText(msg, { x: M + 10, y: cur.y - 14, size: 8, font, color: GRAY });
    cur.y -= 20;
  }

  // ── Status / Transaction tab pills (single side-by-side row) ────────────
  const PILL_H   = 14;
  const PILL_PAD = 5;
  const PILL_GAP = 4;
  const PILL_FS  = 6.5;

  function drawTabPill(label: string, count: number, px: number, py: number, col: Color): number {
    const txt = `${label} (${count})`;
    const tw  = font.widthOfTextAtSize(txt, PILL_FS);
    const pw  = tw + PILL_PAD * 2;
    cur.pg.drawRectangle({ x: px, y: py - PILL_H, width: pw, height: PILL_H, color: LT_GRAY, borderColor: BORDER, borderWidth: 0.5 });
    cur.pg.drawText(txt, { x: px + PILL_PAD, y: py - 10, size: PILL_FS, font, color: col });
    return pw + PILL_GAP;
  }

  // Count orders by status
  const oCount: Record<string, number> = {};
  data.orders.forEach(o => {
    const s = (o.status || 'pending').toLowerCase();
    oCount[s] = (oCount[s] || 0) + 1;
  });

  // Count transactions by purpose
  const tCount: Record<string, number> = {};
  data.txns.forEach(t => {
    const p = (t.purpose || t.type || '').toLowerCase();
    tCount[p] = (tCount[p] || 0) + 1;
  });

  // Single row: Orders group on the left, Transactions group immediately after
  need(PILL_H + 4);
  const tabRowY = cur.y;

  cur.pg.drawText('Orders', { x: M, y: tabRowY - 10, size: PILL_FS, font: bold, color: GRAY });
  let pillX = M + font.widthOfTextAtSize('Orders', PILL_FS) + 6;
  pillX += drawTabPill('Pending',   oCount['pending']   || 0, pillX, tabRowY, AMBER);
  pillX += drawTabPill('Confirmed', oCount['confirmed'] || 0, pillX, tabRowY, GREEN);
  pillX += drawTabPill('Cancelled', (oCount['cancelled'] || 0) + (oCount['canceled'] || 0), pillX, tabRowY, RED);

  pillX += 16;

  cur.pg.drawText('Transactions', { x: pillX, y: tabRowY - 10, size: PILL_FS, font: bold, color: GRAY });
  pillX += font.widthOfTextAtSize('Transactions', PILL_FS) + 6;
  pillX += drawTabPill('Affiliate',  (tCount['commission'] || 0) + (tCount['affiliate'] || 0), pillX, tabRowY, PINK);
  pillX += drawTabPill('Withdrawal', tCount['withdrawal'] || 0, pillX, tabRowY, RED);
  pillX += drawTabPill('Refund',     tCount['refund']     || 0, pillX, tabRowY, AMBER);
  pillX += drawTabPill('VCredit',    (tCount['reward'] || 0) + (tCount['vcredit'] || 0), pillX, tabRowY, GREEN);
  void drawTabPill('Dispute',        data.disputes.length,     pillX, tabRowY, GRAY);

  cur.y -= PILL_H + 20;

  // ── Orders ───────────────────────────────────────────────────────────────
  sectionTitle('ALL ORDERS IN PERIOD', data.orders.length);

  const orderCols: Col[] = [
    { h: 'S/N',      w: 28              },
    { h: 'ORDER #',  w: 82              },
    { h: 'DATE',     w: 62              },
    { h: 'CUSTOMER', w: 112             },
    { h: 'ITEMS',    w: 38, right: true },
    { h: 'AMOUNT',   w: 96, right: true },
    { h: 'STATUS',   w: 97              },
  ];

  if (data.orders.length === 0) {
    noData('No orders in this period.');
  } else {
    tableHeader(orderCols);
    data.orders.forEach((o, i) => {
      const sc = statusColour(o.status);
      tableRow(
        orderCols,
        [String(i + 1), o.orderNumber, fmtDate(o.date), o.customer, String(o.itemCount), fmtMoney(o.vendorAmount), cap(o.status)],
        i,
        [GRAY, DARK, DARK, DARK, GRAY, o.vendorAmount > 0 ? GREEN : DARK, sc],
      );
    });
  }

  // ── Wallet Transactions ───────────────────────────────────────────────────
  cur.y -= 20;
  sectionTitle('WALLET TRANSACTIONS (CREDITS & DEBITS)', data.txns.length);

  const txnCols: Col[] = [
    { h: 'S/N',         w: 28  },
    { h: 'Date',        w: 66  },
    { h: 'TYPE',        w: 56  },
    { h: 'PURPOSE',     w: 88  },
    { h: 'AMOUNT',      w: 95, right: true },
    { h: 'DESCRIPTION', w: 182 },
  ];

  if (data.txns.length === 0) {
    noData('No wallet transactions in this period.');
  } else {
    tableHeader(txnCols);
    data.txns.forEach((t, i) => {
      const isCredit = t.type.toLowerCase() === 'credit';
      const typeColor = isCredit ? GREEN : RED;
      const amtColor  = isCredit ? GREEN : RED;
      const sign      = isCredit ? '+' : '-';
      tableRow(
        txnCols,
        [String(i + 1), fmtDate(t.date), cap(t.type), cap(t.purpose), `${sign} ${fmtMoney(t.amount)}`, t.description],
        i,
        [GRAY, DARK, typeColor, DARK, amtColor, GRAY],
      );
    });
  }

  // ── Disputes ──────────────────────────────────────────────────────────────
  cur.y -= 20;
  sectionTitle('DISPUTE', data.disputes.length);

  const dispCols: Col[] = [
    { h: 'S/N',       w: 28  },
    { h: 'DISPUTE #', w: 82  },
    { h: 'DATE',      w: 66  },
    { h: 'ORDER #',   w: 82  },
    { h: 'REASON',    w: 140 },
    { h: 'STATUS',    w: 117 },
  ];

  if (data.disputes.length === 0) {
    noData('No disputes in this period.');
  } else {
    tableHeader(dispCols);
    data.disputes.forEach((d, i) => {
      const sc = statusColour(d.status);
      tableRow(
        dispCols,
        [String(i + 1), d.disputeNumber, fmtDate(d.date), d.orderNumber, cap(d.reason), cap(d.status)],
        i,
        [GRAY, DARK, DARK, DARK, DARK, sc],
      );
    });
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  need(36);
  cur.y -= 20;
  cur.pg.drawLine({
    start: { x: M, y: cur.y },
    end:   { x: PW - M, y: cur.y },
    thickness: 0.75, color: PINK,
  });
  cur.y -= 14;
  cur.pg.drawText(
    `This statement was automatically generated by Vendorspot on ${fmtDate(new Date())}. For queries, contact support@vendorspotng.com`,
    { x: M, y: cur.y, size: 7, font, color: GRAY },
  );

  // Page numbers
  const pageCount = pdf.getPageCount();
  for (let p = 0; p < pageCount; p++) {
    pdf.getPage(p).drawText(`Page ${p + 1} of ${pageCount}`, {
      x: PW - M - 55, y: 22, size: 7, font, color: GRAY,
    });
  }

  return Buffer.from(await pdf.save());
}
