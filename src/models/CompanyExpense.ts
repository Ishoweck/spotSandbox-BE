import mongoose, { Schema, Document, Types } from 'mongoose';

export enum ExpenseCategory {
  INFRASTRUCTURE = 'infrastructure',
  TOOLS          = 'tools',
  MARKETING      = 'marketing',
  OPERATIONS     = 'operations',
  SALARIES       = 'salaries',
  LEGAL          = 'legal',
  TAX            = 'tax',
  OTHER          = 'other',
}

export enum ExpenseStatus {
  PENDING = 'pending',
  PAID    = 'paid',
  OVERDUE = 'overdue',
}

export enum RecurringInterval {
  MONTHLY   = 'monthly',
  QUARTERLY = 'quarterly',
  YEARLY    = 'yearly',
}

export interface ICompanyExpense extends Document {
  expenseRef:         string;
  title:              string;
  description?:       string;
  category:           ExpenseCategory;
  amount:             number;
  currency:           string;
  status:             ExpenseStatus;
  paidAt?:            Date;
  dueDate?:           Date;
  paidBy?:            Types.ObjectId;
  vendor?:            string;
  receiptUrl?:        string;
  evidence?:          string[];
  isRecurring:        boolean;
  recurringInterval?: RecurringInterval;
  nextDueDate?:       Date;
  tags?:              string[];
  notes?:             string;
  createdBy:          Types.ObjectId;
  updatedBy?:         Types.ObjectId;
  createdAt:          Date;
  updatedAt:          Date;
}

const CompanyExpenseSchema = new Schema<ICompanyExpense>(
  {
    expenseRef:         { type: String, unique: true },
    title:              { type: String, required: true, trim: true },
    description:        { type: String, trim: true },
    category:           { type: String, enum: Object.values(ExpenseCategory), required: true },
    amount:             { type: Number, required: true, min: 0 },
    currency:           { type: String, default: 'NGN' },
    status:             { type: String, enum: Object.values(ExpenseStatus), default: ExpenseStatus.PENDING },
    paidAt:             { type: Date },
    dueDate:            { type: Date },
    paidBy:             { type: Schema.Types.ObjectId, ref: 'User' },
    vendor:             { type: String, trim: true },
    receiptUrl:         { type: String },
    evidence:           [{ type: String }],
    isRecurring:        { type: Boolean, default: false },
    recurringInterval:  { type: String, enum: Object.values(RecurringInterval) },
    nextDueDate:        { type: Date },
    tags:               [{ type: String, trim: true }],
    notes:              { type: String },
    createdBy:          { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy:          { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// Auto-generate expenseRef before saving
CompanyExpenseSchema.pre('save', async function (next) {
  if (this.expenseRef) return next();
  const count = await mongoose.model('CompanyExpense').countDocuments();
  const year  = new Date().getFullYear();
  this.expenseRef = `EXP-${year}-${String(count + 1).padStart(4, '0')}`;
  next();
});

// Auto-compute nextDueDate for recurring on save
CompanyExpenseSchema.pre('save', function (next) {
  if (this.isRecurring && this.paidAt && this.recurringInterval) {
    const base = new Date(this.paidAt);
    if (this.recurringInterval === RecurringInterval.MONTHLY)   base.setMonth(base.getMonth() + 1);
    if (this.recurringInterval === RecurringInterval.QUARTERLY) base.setMonth(base.getMonth() + 3);
    if (this.recurringInterval === RecurringInterval.YEARLY)    base.setFullYear(base.getFullYear() + 1);
    this.nextDueDate = base;
  }
  next();
});

CompanyExpenseSchema.index({ status: 1 });
CompanyExpenseSchema.index({ category: 1 });
CompanyExpenseSchema.index({ dueDate: 1 });
CompanyExpenseSchema.index({ createdAt: -1 });

export default mongoose.model<ICompanyExpense>('CompanyExpense', CompanyExpenseSchema);
