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

// Load logo once at module level (png file in public/ at repo root)
let LOGO_BYTES: Buffer | null = null;
try {
  LOGO_BYTES = fs.readFileSync(path.join(__dirname, '../../public/logo.png'));
} catch {
  // logo file not found — PDF will fall back to text mark
}

// ─── Layout Constants ────────────────────────────────────────────────────────
const PW = 595;          // A4 width (points)
const PH = 842;          // A4 height (points)
const M  = 40;           // margin
const CW = PW - M * 2;  // content width = 515

// ─── Brand Colours ───────────────────────────────────────────────────────────
const PINK     = rgb(0.800, 0.200, 0.400);
const DARK     = rgb(0.067, 0.094, 0.153);
const GRAY     = rgb(0.420, 0.447, 0.502);
const LT_GRAY  = rgb(0.953, 0.957, 0.965);
const WHITE    = rgb(1,     1,     1    );
const GREEN    = rgb(0.063, 0.725, 0.506);
const RED      = rgb(0.937, 0.267, 0.267);
const AMBER    = rgb(0.961, 0.620, 0.043);
const PINK_LT  = rgb(1.000, 0.941, 0.961);
const PINK_MID = rgb(0.950, 0.870, 0.910);

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
  if (['delivered', 'completed', 'resolved_full_refund', 'resolved_partial_refund', 'credit'].includes(s)) return GREEN;
  if (['cancelled', 'rejected', 'failed', 'debit'].includes(s)) return RED;
  if (['pending', 'open', 'under_review', 'processing'].includes(s)) return AMBER;
  return GRAY;
}

// ─── Types ───────────────────────────────────────────────────────────────────
export interface StatementData {
  vendor: { name: string; email: string; storeName: string };
  period: { start: Date; end: Date };
  summary: {
    totalRevenue:    number; // gross sales from ALL orders in period
    earnedRevenue:   number; // from delivered/completed orders only
    totalOrders:     number;
    totalItems:      number; // items across ALL orders in period
    walletBalance:   number; // current available balance
    pendingBalance:  number; // earnings pending release
    totalWithdrawn:  number; // total ever withdrawn (lifetime)
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
    VendorProfile.findOne({ user: vid }).select('storeName').lean(),
    Order.find({
      'vendorShipments.vendor': vid,
      createdAt: { $gte: startDate, $lte: end },
    }).populate('user', 'firstName lastName').lean(),
    Wallet.findOne({ user: vid }).lean(),
    Dispute.find({ vendor: vid, createdAt: { $gte: startDate, $lte: end } }).lean(),
  ]);

  // Build order rows — items have { _id: false } in schema so we match by the
  // vendor field that each order item carries directly (not by _id).
  // ALL orders are listed regardless of status (it's a full statement).
  // Revenue totals:
  //   totalRevenue  = gross sales from ALL orders in period
  //   earnedRevenue = only delivered/completed orders (money actually earned)
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
    if (FULFILLED.has((o.status || '').toLowerCase())) {
      earnedRevenue += vendorAmount;
    }

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

  // Wallet transactions filtered by date
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

  return {
    vendor: {
      name,
      email:     (vendorUser as any)?.email || '',
      storeName: (vendorProfile as any)?.storeName || name,
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

  // Embed real logo PNG if available
  let logoImg: PDFImage | null = null;
  if (LOGO_BYTES) {
    try { logoImg = await pdf.embedPng(LOGO_BYTES); } catch {}
  }

  // Mutable page cursor
  const cur: { pg: PDFPage; y: number } = { pg: null as any, y: 0 };

  function newPage(continuation = false) {
    cur.pg = pdf.addPage([PW, PH]);
    if (continuation) {
      cur.pg.drawRectangle({ x: 0, y: PH - 28, width: PW, height: 28, color: PINK });
      cur.pg.drawText('Vendorspot  |  Account Statement (continued)', {
        x: M, y: PH - 19, size: 8, font, color: WHITE,
      });
      cur.y = PH - 50;
    } else {
      cur.y = PH;
    }
  }

  function need(h: number) {
    if (cur.y - h < M + 30) newPage(true);
  }

  // ── Page 1 Header ────────────────────────────────────────────────────────
  newPage(false);

  // Pink header band
  cur.pg.drawRectangle({ x: 0, y: PH - 152, width: PW, height: 152, color: PINK });

  // ── Logo area ──
  // White square backdrop so the pink logo is visible on the pink header
  const LOGO_SZ = 48;
  const LOGO_X  = M;
  const LOGO_Y  = PH - 66; // bottom-left y of logo box

  cur.pg.drawRectangle({ x: LOGO_X, y: LOGO_Y, width: LOGO_SZ, height: LOGO_SZ, color: WHITE });

  if (logoImg) {
    // Real PNG logo — draw inside the white box with 4pt padding
    cur.pg.drawImage(logoImg, { x: LOGO_X + 4, y: LOGO_Y + 4, width: LOGO_SZ - 8, height: LOGO_SZ - 8 });
  } else {
    // Text fallback: pink "V" on white box
    cur.pg.drawText('V', { x: LOGO_X + 14, y: LOGO_Y + 14, size: 26, font: bold, color: PINK });
  }

  // Brand wordmark: "endorspot" in white next to logo
  const BRAND_X = LOGO_X + LOGO_SZ + 12;
  const BRAND_Y = LOGO_Y + LOGO_SZ - 20;
  cur.pg.drawText('endorspot', { x: BRAND_X, y: BRAND_Y, size: 18, font: bold, color: WHITE });
  cur.pg.drawText('Confidence in every click', { x: BRAND_X, y: BRAND_Y - 14, size: 7.5, font, color: PINK_MID });

  // "ACCOUNT STATEMENT" label right-aligned, same vertical centre as logo
  cur.pg.drawText('ACCOUNT STATEMENT', { x: PW - M - 118, y: BRAND_Y, size: 10, font: bold, color: WHITE });

  // Horizontal divider below logo band
  cur.pg.drawLine({ start: { x: M, y: PH - 76 }, end: { x: PW - M, y: PH - 76 }, thickness: 0.5, color: PINK_MID });

  // Store info
  cur.pg.drawText(trunc(data.vendor.storeName, 44), { x: M, y: PH - 94,  size: 12, font: bold, color: WHITE });
  cur.pg.drawText(data.vendor.name,                  { x: M, y: PH - 110, size: 9,  font,       color: PINK_MID });
  cur.pg.drawText(data.vendor.email,                 { x: M, y: PH - 123, size: 9,  font,       color: PINK_MID });

  // Period + generated date
  cur.pg.drawText(`Period: ${fmtDate(data.period.start)} – ${fmtDate(data.period.end)}`,
    { x: M, y: PH - 140, size: 8.5, font, color: PINK_MID });
  cur.pg.drawText(`Generated: ${fmtDate(new Date())}`,
    { x: PW - M - 150, y: PH - 140, size: 8.5, font, color: PINK_MID });

  cur.y = PH - 152 - 18;

  // ── Summary Cards (2 rows × 3 columns) ──────────────────────────────────
  const row1Cards = [
    { label: 'Gross Sales (Period)',  value: fmtMoney(data.summary.totalRevenue),   note: 'all orders'        },
    { label: 'Earned Revenue',        value: fmtMoney(data.summary.earnedRevenue),  note: 'delivered only'    },
    { label: 'Total Orders',          value: String(data.summary.totalOrders),       note: 'in period'         },
  ];
  const row2Cards = [
    { label: 'Wallet Balance',        value: fmtMoney(data.summary.walletBalance),  note: 'available now'     },
    { label: 'Pending Balance',       value: fmtMoney(data.summary.pendingBalance), note: 'pending release'   },
    { label: 'Items (All Orders)',     value: String(data.summary.totalItems),        note: 'units in period'   },
  ];

  const cW3 = (CW - 6) / 3;
  const cH  = 62;

  const drawCardRow = (cards: typeof row1Cards, rowY: number) => {
    cards.forEach((card, i) => {
      const cx = M + i * (cW3 + 3);
      cur.pg.drawRectangle({ x: cx, y: rowY, width: cW3, height: cH, color: LT_GRAY, borderColor: PINK_MID, borderWidth: 0.5 });
      cur.pg.drawRectangle({ x: cx, y: rowY + cH - 4, width: cW3, height: 4, color: PINK });
      cur.pg.drawText(card.label, { x: cx + 7, y: rowY + cH - 16, size: 6.5, font: bold, color: DARK });
      cur.pg.drawText(card.note,  { x: cx + 7, y: rowY + cH - 26, size: 6,   font,       color: GRAY });
      cur.pg.drawText(trunc(card.value, 18), { x: cx + 7, y: rowY + 12, size: 10.5, font: bold, color: PINK });
    });
  };

  const row1Top = cur.y - cH;
  drawCardRow(row1Cards, row1Top);
  const row2Top = row1Top - 8 - cH;
  need(cH + 8);
  drawCardRow(row2Cards, row2Top);

  cur.y = row2Top - 24;

  // ── Table helper ──────────────────────────────────────────────────────────
  type Col = { h: string; w: number; right?: boolean };

  function sectionTitle(title: string, count: number) {
    need(26);
    cur.pg.drawRectangle({ x: M, y: cur.y - 22, width: CW, height: 22, color: PINK_LT });
    cur.pg.drawText(title, { x: M + 10, y: cur.y - 15, size: 9, font: bold, color: PINK });
    const tw = bold.widthOfTextAtSize(title, 9);
    cur.pg.drawText(`(${count})`, { x: M + 10 + tw + 5, y: cur.y - 15, size: 9, font, color: GRAY });
    cur.y -= 22;
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
      const col_color = colours?.[i] ?? DARK;
      const tx = col.right
        ? cx + col.w - 6 - font.widthOfTextAtSize(raw, 7.5)
        : cx + 5;
      cur.pg.drawText(raw, { x: tx, y: cur.y - 11, size: 7.5, font, color: col_color });
      cx += col.w;
    });
    cur.y -= 15;
  }

  function noData(msg: string) {
    need(24);
    cur.pg.drawRectangle({ x: M, y: cur.y - 22, width: CW, height: 22, color: LT_GRAY });
    cur.pg.drawText(msg, { x: M + 10, y: cur.y - 15, size: 8, font, color: GRAY });
    cur.y -= 22;
  }

  // ── Orders Section (ALL orders regardless of status) ─────────────────────
  cur.y -= 4;
  sectionTitle('ALL ORDERS IN PERIOD', data.orders.length);

  const orderCols: Col[] = [
    { h: 'ORDER #',  w: 88              },
    { h: 'DATE',     w: 68              },
    { h: 'CUSTOMER', w: 120             },
    { h: 'ITEMS',    w: 42, right: true },
    { h: 'AMOUNT',   w: 100, right: true },
    { h: 'STATUS',   w: 97             },
  ];

  if (data.orders.length === 0) {
    noData('No orders in this period.');
  } else {
    tableHeader(orderCols);
    data.orders.forEach((o, i) => {
      const sc = statusColour(o.status);
      tableRow(
        orderCols,
        [o.orderNumber, fmtDate(o.date), o.customer, String(o.itemCount), fmtMoney(o.vendorAmount), cap(o.status)],
        i,
        [DARK, DARK, DARK, GRAY, o.vendorAmount > 0 ? GREEN : DARK, sc],
      );
    });
  }

  // ── Wallet Transactions Section ───────────────────────────────────────────
  cur.y -= 18;
  sectionTitle('WALLET TRANSACTIONS (CREDITS & DEBITS)', data.txns.length);

  const txnCols: Col[] = [
    { h: 'DATE',        w: 72 },
    { h: 'TYPE',        w: 60 },
    { h: 'PURPOSE',     w: 95 },
    { h: 'AMOUNT',      w: 100, right: true },
    { h: 'DESCRIPTION', w: 188 },
  ];

  if (data.txns.length === 0) {
    noData('No wallet transactions in this period.');
  } else {
    tableHeader(txnCols);
    data.txns.forEach((t, i) => {
      const tc = statusColour(t.type);
      const sign = t.type.toLowerCase() === 'credit' ? '+' : '-';
      tableRow(
        txnCols,
        [fmtDate(t.date), cap(t.type), cap(t.purpose), `${sign} ${fmtMoney(t.amount)}`, t.description],
        i,
        [DARK, tc, DARK, tc, GRAY],
      );
    });
  }

  // ── Disputes Section ───────────────────────────────────────────────────────
  cur.y -= 18;
  sectionTitle('DISPUTES', data.disputes.length);

  const dispCols: Col[] = [
    { h: 'DISPUTE #', w: 88 },
    { h: 'DATE',      w: 72 },
    { h: 'ORDER #',   w: 88 },
    { h: 'REASON',    w: 150 },
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
        [d.disputeNumber, fmtDate(d.date), d.orderNumber, cap(d.reason), cap(d.status)],
        i,
        [DARK, DARK, DARK, DARK, sc],
      );
    });
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  need(36);
  cur.y -= 20;
  cur.pg.drawLine({ start: { x: M, y: cur.y }, end: { x: PW - M, y: cur.y }, thickness: 1, color: PINK });
  cur.y -= 14;
  cur.pg.drawText(
    `This statement was automatically generated by Vendorspot on ${fmtDate(new Date())}. For queries, contact support@vendorspotng.com`,
    { x: M, y: cur.y, size: 7, font, color: GRAY },
  );

  // Page numbers
  const pageCount = pdf.getPageCount();
  for (let p = 0; p < pageCount; p++) {
    const pg = pdf.getPage(p);
    pg.drawText(`Page ${p + 1} of ${pageCount}`, {
      x: PW - M - 55, y: 22, size: 7, font, color: GRAY,
    });
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
