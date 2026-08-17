import mongoose, { Schema, Document, Types } from 'mongoose';

// Generic dedup log for all automated/scheduled emails.
// - One-shot reminders: leave periodKey as "ONCE" — that user + type will only ever send once (until TTL).
// - Recurring reminders (weekly digests, etc.): set periodKey to e.g. "2026-W33" so a fresh row is
//   created each period.
export interface IAutomatedEmailLog extends Document {
  recipient: Types.ObjectId;
  type: string;
  periodKey: string;
  meta?: Record<string, any>;
  sentAt: Date;
}

const automatedEmailLogSchema = new Schema<IAutomatedEmailLog>({
  recipient: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  type: {
    type: String,
    required: true,
  },
  periodKey: {
    type: String,
    default: 'ONCE',
    required: true,
  },
  meta: {
    type: Schema.Types.Mixed,
  },
  sentAt: {
    type: Date,
    default: Date.now,
  },
});

// Composite unique — prevents duplicate sends of same reminder in same period
automatedEmailLogSchema.index({ recipient: 1, type: 1, periodKey: 1 }, { unique: true });
// Auto-purge after 180 days — reminders become eligible again after that
automatedEmailLogSchema.index({ sentAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

const AutomatedEmailLog = mongoose.model<IAutomatedEmailLog>('AutomatedEmailLog', automatedEmailLogSchema);
export default AutomatedEmailLog;
