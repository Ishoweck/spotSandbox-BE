// workers/logistics-shadow.worker.ts
//
// Processes the fire-and-forget shadow jobs enqueued by order.controller.
// Calls the new VendorSpot Logistics engine, records the comparison, done.
// Never writes back to the Order — this is a read-only research pipeline.

import { Worker, Job } from 'bullmq';
import { bullmqClient } from '../config/redis';
import { logger } from '../utils/logger';
import { vendorSpotLogisticsClient } from '../services/vendorspot-logistics.client';
import { LogisticsShadowLog } from '../models/LogisticsShadowLog';
import type { LogisticsShadowJobData } from '../queues/logistics-shadow.queue';

async function processShadowJob(job: Job<LogisticsShadowJobData>): Promise<void> {
  const { userId, vendorId, vendorName, sender, receiver, packageItems, logisticsRequest, shipbubble } = job.data;

  const result = await vendorSpotLogisticsClient.getQuote({
    origin: { ...logisticsRequest.origin },
    destination: { ...logisticsRequest.destination },
    packages: logisticsRequest.packages,
  });

  const baseDoc = {
    ...(userId ? { userId } : {}),
    vendorId,
    vendorName,
    sender,
    receiver,
    packageItems,
    shipbubble,
  };

  // Failure path — record and bail (early-return keeps TS narrowing simple)
  if (!result.ok) {
    await LogisticsShadowLog.create({
      ...baseDoc,
      ourResult: {
        ok: false,
        error: result.error,
        errorCategory: result.category,
        durationMs: result.durationMs,
      },
      winner: 'ours_failed' as const,
    });
    logger.info(
      `[LogisticsShadow] vendor=${vendorName} winner=ours_failed shipbubble=₦${shipbubble.cheapestPriceNaira} ` +
      `ours=FAILED (${result.category}: ${result.error})`,
    );
    return;
  }

  // Success path — result is narrowed to { ok: true; data; durationMs }
  const options = result.data.options ?? [];
  const cheapestKobo = options.length ? Math.min(...options.map((o) => o.priceKobo)) : undefined;

  let winner: 'shipbubble' | 'us' | 'tie' | 'ours_failed' = 'ours_failed';
  let priceDeltaNaira: number | undefined;
  if (cheapestKobo !== undefined) {
    const ourNaira = cheapestKobo / 100;
    priceDeltaNaira = ourNaira - shipbubble.cheapestPriceNaira;
    if (Math.abs(priceDeltaNaira) < 1) winner = 'tie';
    else if (priceDeltaNaira < 0) winner = 'us';
    else winner = 'shipbubble';
  }

  await LogisticsShadowLog.create({
    ...baseDoc,
    ourResult: {
      ok: true,
      cheapestPriceKobo: cheapestKobo,
      optionCount: options.length,
      quoteId: result.data.id,
      options: options.map((o) => ({
        carrier: o.carrierId,
        priceKobo: o.priceKobo,
        etaHours: o.etaHours,
      })),
      unavailable: result.data.unavailable ?? [],
      durationMs: result.durationMs,
    },
    winner,
    ...(priceDeltaNaira !== undefined ? { priceDeltaNaira } : {}),
  });

  logger.info(
    `[LogisticsShadow] vendor=${vendorName} winner=${winner} shipbubble=₦${shipbubble.cheapestPriceNaira} ` +
    `ours=₦${cheapestKobo !== undefined ? cheapestKobo / 100 : 'n/a'}`,
  );
}

export function startLogisticsShadowWorker(): void {
  const worker = new Worker<LogisticsShadowJobData, void, string>(
    'logistics-shadow',
    processShadowJob,
    {
      connection: bullmqClient as any,
      concurrency: 5,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error(`[LogisticsShadow] Job ${job?.id} failed:`, err.message);
  });

  logger.info('[Workers] Logistics shadow worker started');
}
