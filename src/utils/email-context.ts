import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-async-context flag set by the email worker so sendEmail() knows
 * the current send is a scheduled/automated email (queued via BullMQ)
 * vs a direct transactional call (OTP, welcome, order confirmation).
 *
 * Only automated sends get the support@ audit BCC.
 */
export const emailContext = new AsyncLocalStorage<{ automated: boolean }>();

export function isAutomatedContext(): boolean {
  return emailContext.getStore()?.automated === true;
}
