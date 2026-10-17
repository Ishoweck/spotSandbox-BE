import { logger } from './logger';
import { releaseDuePaymentLinkPayments } from '../services/payment-link.service';

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes

export function setupPaymentLinkRelease(): void {
  logger.info('⏰ Payment link release scheduler started');
  releaseDuePaymentLinkPayments().catch(err => logger.error('Payment link release startup run failed:', { error: err.message }));
  setInterval(() => {
    releaseDuePaymentLinkPayments().catch(err => logger.error('Payment link release run failed:', { error: err.message }));
  }, CHECK_INTERVAL_MS);
}
