import { Request, Response } from 'express';
import CompanyExpense, { ExpenseCategory, ExpenseStatus } from '../models/CompanyExpense';
import { generateExpensePDF, generateExpenseCSV } from '../services/expenseReport.service';
import cloudinary from '../utils/cloudinary';
import { logger } from '../utils/logger';

// ── helpers ──────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20;

function parsePage(q: any): number {
  const n = parseInt(q, 10);
  return n > 0 ? n : 1;
}

// GET /admin/expenses/summary
export async function getExpenseSummary(req: Request, res: Response) {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const [totalPaid, monthlyPaid, pendingCount, overdueCount, byCategory] = await Promise.all([
    CompanyExpense.aggregate([
      { $match: { status: ExpenseStatus.PAID } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    CompanyExpense.aggregate([
      { $match: { status: ExpenseStatus.PAID, paidAt: { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    CompanyExpense.countDocuments({ status: ExpenseStatus.PENDING }),
    CompanyExpense.countDocuments({ status: ExpenseStatus.OVERDUE }),
    CompanyExpense.aggregate([
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
  ]);

  res.json({
    success: true,
    data: {
      totalPaid:    totalPaid[0]?.total    ?? 0,
      monthlyPaid:  monthlyPaid[0]?.total  ?? 0,
      pendingCount,
      overdueCount,
      byCategory:   byCategory.map(c => ({ category: c._id, total: c.total, count: c.count })),
    },
  });
}

// GET /admin/expenses
export async function listExpenses(req: Request, res: Response) {
  const page     = parsePage(req.query.page);
  const limit    = PAGE_SIZE;
  const skip     = (page - 1) * limit;

  const filter: any = {};

  if (req.query.category)  filter.category  = req.query.category;
  if (req.query.status)    filter.status     = req.query.status;
  if (req.query.recurring) filter.isRecurring = req.query.recurring === 'true';

  if (req.query.search) {
    const rx = new RegExp(String(req.query.search), 'i');
    filter.$or = [{ title: rx }, { vendor: rx }, { expenseRef: rx }, { tags: rx }];
  }

  if (req.query.startDate || req.query.endDate) {
    filter.createdAt = {};
    if (req.query.startDate) filter.createdAt.$gte = new Date(String(req.query.startDate));
    if (req.query.endDate)   filter.createdAt.$lte = new Date(String(req.query.endDate));
  }

  const [items, total] = await Promise.all([
    CompanyExpense.find(filter)
      .populate('createdBy', 'firstName lastName')
      .populate('paidBy',    'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CompanyExpense.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data:    items,
    meta:    { page, limit, total, pages: Math.ceil(total / limit) },
  });
}

// GET /admin/expenses/:id
export async function getExpense(req: Request, res: Response) {
  const expense = await CompanyExpense.findById(req.params.id)
    .populate('createdBy', 'firstName lastName email')
    .populate('paidBy',    'firstName lastName email')
    .lean();

  if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });

  res.json({ success: true, data: expense });
}

// POST /admin/expenses
export async function createExpense(req: Request, res: Response) {
  const {
    title, description, category, amount, currency, dueDate,
    vendor, receiptUrl, isRecurring, recurringInterval, tags, notes,
  } = req.body;

  if (!title || !category || amount == null) {
    return res.status(400).json({ success: false, message: 'title, category, and amount are required' });
  }

  if (!Object.values(ExpenseCategory).includes(category)) {
    return res.status(400).json({ success: false, message: 'Invalid category' });
  }

  const expense = await CompanyExpense.create({
    title, description, category,
    amount: Number(amount),
    currency: currency || 'NGN',
    dueDate:  dueDate ? new Date(dueDate) : undefined,
    vendor, receiptUrl,
    isRecurring:       Boolean(isRecurring),
    recurringInterval: isRecurring ? recurringInterval : undefined,
    tags:  Array.isArray(tags)  ? tags  : [],
    notes,
    createdBy: (req as any).user.id,
  });

  res.status(201).json({ success: true, data: expense, message: 'Expense created' });
}

// PUT /admin/expenses/:id
export async function updateExpense(req: Request, res: Response) {
  const expense = await CompanyExpense.findById(req.params.id);
  if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });

  const allowed = [
    'title','description','category','amount','currency','dueDate',
    'vendor','receiptUrl','isRecurring','recurringInterval','tags','notes',
  ];
  allowed.forEach(k => { if (req.body[k] !== undefined) (expense as any)[k] = req.body[k]; });
  expense.updatedBy = (req as any).user.id;

  await expense.save();
  res.json({ success: true, data: expense, message: 'Expense updated' });
}

// PATCH /admin/expenses/:id/status
export async function updateExpenseStatus(req: Request, res: Response) {
  const { status, paidAt } = req.body;

  if (!Object.values(ExpenseStatus).includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status' });
  }

  const expense = await CompanyExpense.findById(req.params.id);
  if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });

  expense.status    = status;
  expense.updatedBy = (req as any).user.id;

  if (status === ExpenseStatus.PAID) {
    expense.paidAt = paidAt ? new Date(paidAt) : new Date();
    expense.paidBy = (req as any).user.id;
  }

  await expense.save();
  res.json({ success: true, data: expense, message: `Expense marked as ${status}` });
}

// DELETE /admin/expenses/:id  (super admin only — enforced at route level)
export async function deleteExpense(req: Request, res: Response) {
  const expense = await CompanyExpense.findByIdAndDelete(req.params.id);
  if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });
  res.json({ success: true, message: 'Expense deleted' });
}

// POST /admin/expenses/:id/evidence  (multipart upload via multer)
export async function uploadExpenseEvidence(req: Request, res: Response) {
  if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });

  const expense = await CompanyExpense.findById(req.params.id);
  if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });

  const result: any = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'expense-evidence', resource_type: 'auto', transformation: [{ width: 1500, height: 1500, crop: 'limit', quality: 'auto' }] },
      (err, res) => { if (err) reject(err); else resolve(res); },
    );
    stream.end(req.file!.buffer);
  });

  expense.evidence = [...(expense.evidence ?? []), result.secure_url];
  expense.updatedBy = (req as any).user.id;
  await expense.save();

  res.json({ success: true, data: { url: result.secure_url }, message: 'Evidence uploaded' });
}

// DELETE /admin/expenses/:id/evidence
export async function deleteExpenseEvidence(req: Request, res: Response) {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, message: 'url is required' });

  const expense = await CompanyExpense.findById(req.params.id);
  if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });

  expense.evidence  = (expense.evidence ?? []).filter(u => u !== url);
  expense.updatedBy = (req as any).user.id;
  await expense.save();

  res.json({ success: true, message: 'Evidence removed' });
}

// GET /admin/expenses/export/pdf
export async function exportExpensesPDF(req: Request, res: Response) {
  const filter: any = {};
  if (req.query.startDate) filter.createdAt = { ...filter.createdAt, $gte: new Date(String(req.query.startDate)) };
  if (req.query.endDate)   filter.createdAt = { ...filter.createdAt, $lte: new Date(String(req.query.endDate)) };
  if (req.query.category)  filter.category  = req.query.category;
  if (req.query.status)    filter.status     = req.query.status;

  const expenses = await CompanyExpense.find(filter)
    .populate('paidBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .lean();

  const pdf = await generateExpensePDF(expenses, {
    startDate: req.query.startDate ? new Date(String(req.query.startDate)) : undefined,
    endDate:   req.query.endDate   ? new Date(String(req.query.endDate))   : undefined,
  });

  res.set({
    'Content-Type':        'application/pdf',
    'Content-Disposition': `attachment; filename="vendorspot-expenses-${Date.now()}.pdf"`,
    'Content-Length':      pdf.length,
  });
  res.send(pdf);
}

// GET /admin/expenses/export/csv
export async function exportExpensesCSV(req: Request, res: Response) {
  const filter: any = {};
  if (req.query.startDate) filter.createdAt = { ...filter.createdAt, $gte: new Date(String(req.query.startDate)) };
  if (req.query.endDate)   filter.createdAt = { ...filter.createdAt, $lte: new Date(String(req.query.endDate)) };
  if (req.query.category)  filter.category  = req.query.category;
  if (req.query.status)    filter.status     = req.query.status;

  const expenses = await CompanyExpense.find(filter)
    .populate('paidBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .lean();

  const csv = generateExpenseCSV(expenses);

  res.set({
    'Content-Type':        'text/csv',
    'Content-Disposition': `attachment; filename="vendorspot-expenses-${Date.now()}.csv"`,
  });
  res.send(csv);
}
