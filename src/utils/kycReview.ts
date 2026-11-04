import { VendorVerificationStatus } from '../types';
import { trackEvent, SlackEvent } from './slack-events';
import { logger } from './logger';

// A KYC document that an admin actually has to look at: pending, with a real file.
// Empty URLs and the legacy 'nin-lookup' sentinel are placeholders, not uploads.
export const AWAITING_KYC_REVIEW_FILTER = {
  kycDocuments: {
    $elemMatch: {
      verificationStatus: 'pending',
      documentUrl: { $exists: true, $nin: ['', 'nin-lookup'] },
    },
  },
};

/**
 * Call after a vendor uploads KYC documents (before save). Stamps the upload time so the
 * admin "KYC to review" list shows the newest uploads first, and puts a previously rejected
 * vendor back into review so the new document is not stuck under the Rejected tab.
 */
export function markKycSubmitted(vendorProfile: any, types: string[]): void {
  const now = new Date();
  vendorProfile.kycSubmittedAt = now;
  for (const doc of vendorProfile.kycDocuments || []) {
    if (types.includes(doc.type) && doc.verificationStatus === 'pending') doc.uploadedAt = now;
  }

  if (vendorProfile.verificationStatus === VendorVerificationStatus.REJECTED) {
    vendorProfile.verificationStatus = VendorVerificationStatus.PENDING;
    vendorProfile.statusHistory?.push({
      action: 'kyc_resubmitted',
      reason: `Vendor uploaded ${types.join(', ')} after rejection`,
      at: now,
    });
  }
}

/** Fire-and-forget Slack ping so admins know a document is waiting. */
export function notifyKycUploaded(vendorProfile: any, types: string[], actor: { id?: string; email?: string }): void {
  try {
    trackEvent(SlackEvent.VENDOR_NIN_SUBMITTED, {
      actor: { id: actor.id, email: actor.email },
      message: `KYC document uploaded, waiting for admin review - ${vendorProfile.businessName}\nDocuments: ${types.join(', ')}`,
      meta: {
        businessName: vendorProfile.businessName,
        documents: types.join(', '),
        accountStatus: vendorProfile.verificationStatus,
        currentStep: 'Admin review: Vendors > KYC to review',
      },
    });
  } catch (err: any) {
    logger.warn('KYC upload Slack notify failed', { error: err?.message });
  }
}
