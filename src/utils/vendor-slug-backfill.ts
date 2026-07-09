import VendorProfile from '../models/VendorProfile';
import { generateSlug } from './helpers';
import { logger } from './logger';

export async function backfillVendorSlugs(): Promise<void> {
  try {
    const vendors = await VendorProfile.find({ slug: { $in: [null, '', undefined] } })
      .select('_id businessName slug')
      .lean();

    if (vendors.length === 0) return;

    logger.info(`[SlugBackfill] Generating slugs for ${vendors.length} existing vendors`);

    for (const vendor of vendors) {
      const base = generateSlug(vendor.businessName) || 'vendor';
      let candidate = base;
      let counter = 2;

      while (true) {
        const taken = await VendorProfile.findOne({ slug: candidate, _id: { $ne: vendor._id } })
          .select('_id')
          .lean();
        if (!taken) break;
        candidate = `${base}-${counter++}`;
      }

      await VendorProfile.updateOne({ _id: vendor._id }, { $set: { slug: candidate } });
      logger.info(`[SlugBackfill] ${vendor.businessName} → ${candidate}`);
    }

    logger.info('[SlugBackfill] Done');
  } catch (err: any) {
    logger.error('[SlugBackfill] Failed:', err.message);
  }
}
