import { Types } from 'mongoose';
import ProductQuestion from '../models/ProductQuestion';
import { notificationService } from '../services/notification.service';
import { logger } from './logger';

// Reminder windows in hours after a question is asked (1 day, 3 days, 7 days)
const REMINDER_HOURS = [24, 72, 168];
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // check every 6 hours

async function runQuestionReminders(): Promise<void> {
  const now = new Date();

  for (const hours of REMINDER_HOURS) {
    const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);

    // Unanswered questions older than `hours` that haven't had this reminder sent yet
    const questions = await ProductQuestion.find({
      $or: [{ answer: { $exists: false } }, { answer: null }, { answer: '' }],
      createdAt: { $lte: cutoff },
      questionRemindersSent: { $ne: hours },
    })
      .populate('product', 'name vendor')
      .select('product questionRemindersSent');

    if (questions.length === 0) continue;

    // Group by vendor — keep track of all question IDs, and note the first product for navigation
    const byVendor = new Map<string, {
      questionIds: Types.ObjectId[];
      productId: string;
      productName: string;
      firstQuestionId: string;
      count: number;
    }>();

    for (const q of questions) {
      const product = q.product as any;
      if (!product?.vendor) continue;

      const vendorId = product.vendor.toString();
      const productId = product._id.toString();
      const productName = product.name || 'your product';

      if (!byVendor.has(vendorId)) {
        byVendor.set(vendorId, {
          questionIds: [],
          productId,
          productName,
          firstQuestionId: (q._id as Types.ObjectId).toString(),
          count: 0,
        });
      }

      const entry = byVendor.get(vendorId)!;
      entry.questionIds.push(q._id as Types.ObjectId);
      entry.count++;
    }

    for (const [vendorId, { questionIds, productId, productName, firstQuestionId, count }] of byVendor) {
      try {
        await notificationService.questionUnansweredReminder(
          vendorId,
          count,
          productName,
          productId,
          firstQuestionId,
          hours,
        );

        // Mark all these questions so we don't remind for this window again
        await ProductQuestion.updateMany(
          { _id: { $in: questionIds } },
          { $addToSet: { questionRemindersSent: hours } },
        );

        logger.info(`❓ Sent ${hours}h question reminder to vendor ${vendorId} (${count} unanswered)`);
      } catch (err: any) {
        logger.error(`Error sending ${hours}h question reminder to vendor ${vendorId}:`, err.message);
      }
    }
  }
}

export function setupQuestionReminders(): void {
  logger.info('❓ Question unanswered reminder scheduler started (every 6h)');
  runQuestionReminders().catch(err =>
    logger.error('Question reminder startup run failed:', err.message),
  );
  setInterval(() => {
    runQuestionReminders().catch(err =>
      logger.error('Question reminder interval run failed:', err.message),
    );
  }, CHECK_INTERVAL_MS);
}
