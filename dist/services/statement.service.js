"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.gatherStatementData = gatherStatementData;
exports.generateStatementPDF = generateStatementPDF;
const pdf_lib_1 = require("pdf-lib");
const mongoose_1 = require("mongoose");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const Order_1 = __importDefault(require("../models/Order"));
const Wallet_1 = __importDefault(require("../models/Wallet"));
const Dispute_1 = __importDefault(require("../models/Dispute"));
const VendorProfile_1 = __importDefault(require("../models/VendorProfile"));
const User_1 = __importDefault(require("../models/User"));
// Load logo once at module level (png file in public/ at repo root)
let LOGO_BYTES = null;
try {
    LOGO_BYTES = fs_1.default.readFileSync(path_1.default.join(__dirname, '../../public/logo.png'));
}
catch {
    // logo file not found — PDF will fall back to text mark
}
// ─── Layout Constants ────────────────────────────────────────────────────────
const PW = 595; // A4 width (points)
const PH = 842; // A4 height (points)
const M = 40; // margin
const CW = PW - M * 2; // content width = 515
// ─── Brand Colours ───────────────────────────────────────────────────────────
const PINK = (0, pdf_lib_1.rgb)(0.800, 0.200, 0.400);
const DARK = (0, pdf_lib_1.rgb)(0.067, 0.094, 0.153);
const GRAY = (0, pdf_lib_1.rgb)(0.420, 0.447, 0.502);
const LT_GRAY = (0, pdf_lib_1.rgb)(0.953, 0.957, 0.965);
const WHITE = (0, pdf_lib_1.rgb)(1, 1, 1);
const GREEN = (0, pdf_lib_1.rgb)(0.063, 0.725, 0.506);
const RED = (0, pdf_lib_1.rgb)(0.937, 0.267, 0.267);
const AMBER = (0, pdf_lib_1.rgb)(0.961, 0.620, 0.043);
const PINK_LT = (0, pdf_lib_1.rgb)(1.000, 0.941, 0.961);
const PINK_MID = (0, pdf_lib_1.rgb)(0.950, 0.870, 0.910);
// ─── Utilities ───────────────────────────────────────────────────────────────
const trunc = (s, n) => {
    const str = String(s ?? '');
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
};
const fmtMoney = (n) => 'NGN ' + (n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const cap = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
function statusColour(status) {
    const s = (status || '').toLowerCase();
    if (['delivered', 'completed', 'resolved_full_refund', 'resolved_partial_refund', 'credit'].includes(s))
        return GREEN;
    if (['cancelled', 'rejected', 'failed', 'debit'].includes(s))
        return RED;
    if (['pending', 'open', 'under_review', 'processing'].includes(s))
        return AMBER;
    return GRAY;
}
// ─── Data Gathering ──────────────────────────────────────────────────────────
async function gatherStatementData(vendorId, startDate, endDate) {
    const vid = new mongoose_1.Types.ObjectId(vendorId);
    startDate.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    const [vendorUser, vendorProfile, rawOrders, wallet, disputes] = await Promise.all([
        User_1.default.findById(vid).select('firstName lastName email').lean(),
        VendorProfile_1.default.findOne({ user: vid }).select('storeName').lean(),
        Order_1.default.find({
            'vendorShipments.vendor': vid,
            createdAt: { $gte: startDate, $lte: end },
        }).populate('user', 'firstName lastName').lean(),
        Wallet_1.default.findOne({ user: vid }).lean(),
        Dispute_1.default.find({ vendor: vid, createdAt: { $gte: startDate, $lte: end } }).lean(),
    ]);
    // Build order rows — items have { _id: false } in schema so we match by the
    // vendor field that each order item carries directly (not by _id).
    // ALL orders are listed regardless of status (it's a full statement).
    // Revenue totals:
    //   totalRevenue  = gross sales from ALL orders in period
    //   earnedRevenue = only delivered/completed orders (money actually earned)
    let totalRevenue = 0;
    let earnedRevenue = 0;
    let totalItems = 0;
    const FULFILLED = new Set(['delivered', 'completed']);
    const orders = rawOrders.map(o => {
        const myItems = (o.items || []).filter((it) => (it.vendor?._id || it.vendor)?.toString() === vendorId);
        const vendorAmount = myItems.reduce((s, it) => s + (it.price || 0) * (it.quantity || 1), 0);
        const qtyCount = myItems.reduce((s, it) => s + (it.quantity || 1), 0);
        totalRevenue += vendorAmount;
        totalItems += qtyCount;
        if (FULFILLED.has((o.status || '').toLowerCase())) {
            earnedRevenue += vendorAmount;
        }
        const customer = o.user
            ? `${o.user.firstName || ''} ${o.user.lastName || ''}`.trim()
            : 'Customer';
        return {
            orderNumber: o.orderNumber || '',
            date: o.createdAt,
            customer: customer || 'Customer',
            vendorAmount,
            status: o.status || 'pending',
            itemCount: qtyCount,
        };
    });
    // Wallet transactions filtered by date
    const txns = (wallet?.transactions || [])
        .filter((t) => {
        const ts = new Date(t.timestamp || t.createdAt);
        return !isNaN(ts.getTime()) && ts >= startDate && ts <= end;
    })
        .map((t) => ({
        date: new Date(t.timestamp || t.createdAt),
        type: t.type || '',
        purpose: t.purpose || '',
        amount: Number(t.amount) || 0,
        description: t.description || t.reference || '',
    }));
    const name = vendorUser
        ? `${vendorUser.firstName || ''} ${vendorUser.lastName || ''}`.trim()
        : 'Vendor';
    return {
        vendor: {
            name,
            email: vendorUser?.email || '',
            storeName: vendorProfile?.storeName || name,
        },
        period: { start: startDate, end },
        summary: {
            totalRevenue,
            earnedRevenue,
            totalOrders: orders.length,
            totalItems,
            walletBalance: wallet?.balance || 0,
            pendingBalance: wallet?.pendingBalance || 0,
            totalWithdrawn: wallet?.totalWithdrawn || 0,
        },
        orders,
        txns,
        disputes: disputes.map(d => ({
            disputeNumber: d.disputeNumber || '',
            date: d.createdAt,
            orderNumber: d.orderNumber || '',
            reason: d.reason || '',
            status: d.status || '',
            refundAmount: d.refundAmount,
        })),
    };
}
// ─── PDF Generation ──────────────────────────────────────────────────────────
async function generateStatementPDF(data) {
    const pdf = await pdf_lib_1.PDFDocument.create();
    const font = await pdf.embedFont(pdf_lib_1.StandardFonts.Helvetica);
    const bold = await pdf.embedFont(pdf_lib_1.StandardFonts.HelveticaBold);
    // Embed real logo PNG if available
    let logoImg = null;
    if (LOGO_BYTES) {
        try {
            logoImg = await pdf.embedPng(LOGO_BYTES);
        }
        catch { }
    }
    // Mutable page cursor
    const cur = { pg: null, y: 0 };
    function newPage(continuation = false) {
        cur.pg = pdf.addPage([PW, PH]);
        if (continuation) {
            cur.pg.drawRectangle({ x: 0, y: PH - 28, width: PW, height: 28, color: PINK });
            cur.pg.drawText('Vendorspot  |  Account Statement (continued)', {
                x: M, y: PH - 19, size: 8, font, color: WHITE,
            });
            cur.y = PH - 50;
        }
        else {
            cur.y = PH;
        }
    }
    function need(h) {
        if (cur.y - h < M + 30)
            newPage(true);
    }
    // ── Page 1 Header ────────────────────────────────────────────────────────
    newPage(false);
    // Pink header band
    cur.pg.drawRectangle({ x: 0, y: PH - 152, width: PW, height: 152, color: PINK });
    // ── Logo area ──
    // White square backdrop so the pink logo is visible on the pink header
    const LOGO_SZ = 48;
    const LOGO_X = M;
    const LOGO_Y = PH - 66; // bottom-left y of logo box
    cur.pg.drawRectangle({ x: LOGO_X, y: LOGO_Y, width: LOGO_SZ, height: LOGO_SZ, color: WHITE });
    if (logoImg) {
        // Real PNG logo — draw inside the white box with 4pt padding
        cur.pg.drawImage(logoImg, { x: LOGO_X + 4, y: LOGO_Y + 4, width: LOGO_SZ - 8, height: LOGO_SZ - 8 });
    }
    else {
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
    cur.pg.drawText(trunc(data.vendor.storeName, 44), { x: M, y: PH - 94, size: 12, font: bold, color: WHITE });
    cur.pg.drawText(data.vendor.name, { x: M, y: PH - 110, size: 9, font, color: PINK_MID });
    cur.pg.drawText(data.vendor.email, { x: M, y: PH - 123, size: 9, font, color: PINK_MID });
    // Period + generated date
    cur.pg.drawText(`Period: ${fmtDate(data.period.start)} – ${fmtDate(data.period.end)}`, { x: M, y: PH - 140, size: 8.5, font, color: PINK_MID });
    cur.pg.drawText(`Generated: ${fmtDate(new Date())}`, { x: PW - M - 150, y: PH - 140, size: 8.5, font, color: PINK_MID });
    cur.y = PH - 152 - 18;
    // ── Summary Cards (2 rows × 3 columns) ──────────────────────────────────
    const row1Cards = [
        { label: 'Gross Sales (Period)', value: fmtMoney(data.summary.totalRevenue), note: 'all orders' },
        { label: 'Earned Revenue', value: fmtMoney(data.summary.earnedRevenue), note: 'delivered only' },
        { label: 'Total Orders', value: String(data.summary.totalOrders), note: 'in period' },
    ];
    const row2Cards = [
        { label: 'Wallet Balance', value: fmtMoney(data.summary.walletBalance), note: 'available now' },
        { label: 'Pending Balance', value: fmtMoney(data.summary.pendingBalance), note: 'pending release' },
        { label: 'Items (All Orders)', value: String(data.summary.totalItems), note: 'units in period' },
    ];
    const cW3 = (CW - 6) / 3;
    const cH = 62;
    const drawCardRow = (cards, rowY) => {
        cards.forEach((card, i) => {
            const cx = M + i * (cW3 + 3);
            cur.pg.drawRectangle({ x: cx, y: rowY, width: cW3, height: cH, color: LT_GRAY, borderColor: PINK_MID, borderWidth: 0.5 });
            cur.pg.drawRectangle({ x: cx, y: rowY + cH - 4, width: cW3, height: 4, color: PINK });
            cur.pg.drawText(card.label, { x: cx + 7, y: rowY + cH - 16, size: 6.5, font: bold, color: DARK });
            cur.pg.drawText(card.note, { x: cx + 7, y: rowY + cH - 26, size: 6, font, color: GRAY });
            cur.pg.drawText(trunc(card.value, 18), { x: cx + 7, y: rowY + 12, size: 10.5, font: bold, color: PINK });
        });
    };
    const row1Top = cur.y - cH;
    drawCardRow(row1Cards, row1Top);
    const row2Top = row1Top - 8 - cH;
    need(cH + 8);
    drawCardRow(row2Cards, row2Top);
    cur.y = row2Top - 24;
    function sectionTitle(title, count) {
        need(26);
        cur.pg.drawRectangle({ x: M, y: cur.y - 22, width: CW, height: 22, color: PINK_LT });
        cur.pg.drawText(title, { x: M + 10, y: cur.y - 15, size: 9, font: bold, color: PINK });
        const tw = bold.widthOfTextAtSize(title, 9);
        cur.pg.drawText(`(${count})`, { x: M + 10 + tw + 5, y: cur.y - 15, size: 9, font, color: GRAY });
        cur.y -= 22;
    }
    function tableHeader(cols) {
        need(20);
        cur.pg.drawRectangle({ x: M, y: cur.y - 18, width: CW, height: 18, color: DARK });
        let cx = M;
        for (const col of cols) {
            cur.pg.drawText(col.h, { x: cx + 5, y: cur.y - 13, size: 7.5, font: bold, color: WHITE });
            cx += col.w;
        }
        cur.y -= 18;
    }
    function tableRow(cols, vals, idx, colours) {
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
    function noData(msg) {
        need(24);
        cur.pg.drawRectangle({ x: M, y: cur.y - 22, width: CW, height: 22, color: LT_GRAY });
        cur.pg.drawText(msg, { x: M + 10, y: cur.y - 15, size: 8, font, color: GRAY });
        cur.y -= 22;
    }
    // ── Orders Section (ALL orders regardless of status) ─────────────────────
    cur.y -= 4;
    sectionTitle('ALL ORDERS IN PERIOD', data.orders.length);
    const orderCols = [
        { h: 'ORDER #', w: 88 },
        { h: 'DATE', w: 68 },
        { h: 'CUSTOMER', w: 120 },
        { h: 'ITEMS', w: 42, right: true },
        { h: 'AMOUNT', w: 100, right: true },
        { h: 'STATUS', w: 97 },
    ];
    if (data.orders.length === 0) {
        noData('No orders in this period.');
    }
    else {
        tableHeader(orderCols);
        data.orders.forEach((o, i) => {
            const sc = statusColour(o.status);
            tableRow(orderCols, [o.orderNumber, fmtDate(o.date), o.customer, String(o.itemCount), fmtMoney(o.vendorAmount), cap(o.status)], i, [DARK, DARK, DARK, GRAY, o.vendorAmount > 0 ? GREEN : DARK, sc]);
        });
    }
    // ── Wallet Transactions Section ───────────────────────────────────────────
    cur.y -= 18;
    sectionTitle('WALLET TRANSACTIONS (CREDITS & DEBITS)', data.txns.length);
    const txnCols = [
        { h: 'DATE', w: 72 },
        { h: 'TYPE', w: 60 },
        { h: 'PURPOSE', w: 95 },
        { h: 'AMOUNT', w: 100, right: true },
        { h: 'DESCRIPTION', w: 188 },
    ];
    if (data.txns.length === 0) {
        noData('No wallet transactions in this period.');
    }
    else {
        tableHeader(txnCols);
        data.txns.forEach((t, i) => {
            const tc = statusColour(t.type);
            const sign = t.type.toLowerCase() === 'credit' ? '+' : '-';
            tableRow(txnCols, [fmtDate(t.date), cap(t.type), cap(t.purpose), `${sign} ${fmtMoney(t.amount)}`, t.description], i, [DARK, tc, DARK, tc, GRAY]);
        });
    }
    // ── Disputes Section ───────────────────────────────────────────────────────
    cur.y -= 18;
    sectionTitle('DISPUTES', data.disputes.length);
    const dispCols = [
        { h: 'DISPUTE #', w: 88 },
        { h: 'DATE', w: 72 },
        { h: 'ORDER #', w: 88 },
        { h: 'REASON', w: 150 },
        { h: 'STATUS', w: 117 },
    ];
    if (data.disputes.length === 0) {
        noData('No disputes in this period.');
    }
    else {
        tableHeader(dispCols);
        data.disputes.forEach((d, i) => {
            const sc = statusColour(d.status);
            tableRow(dispCols, [d.disputeNumber, fmtDate(d.date), d.orderNumber, cap(d.reason), cap(d.status)], i, [DARK, DARK, DARK, DARK, sc]);
        });
    }
    // ── Footer ─────────────────────────────────────────────────────────────────
    need(36);
    cur.y -= 20;
    cur.pg.drawLine({ start: { x: M, y: cur.y }, end: { x: PW - M, y: cur.y }, thickness: 1, color: PINK });
    cur.y -= 14;
    cur.pg.drawText(`This statement was automatically generated by Vendorspot on ${fmtDate(new Date())}. For queries, contact support@vendorspotng.com`, { x: M, y: cur.y, size: 7, font, color: GRAY });
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
//# sourceMappingURL=statement.service.js.map