// queues/logistics-shadow.queue.ts
//
// Fire-and-forget queue for shadowing ShipBubble rate fetches against the new
// VendorSpot Logistics engine. Jobs are enqueued from order.controller after
// ShipBubble successfully returns rates, so we have both request AND response
// data available at enqueue time (nice for the log row).

import { Queue } from 'bullmq';
import { bullmqClient } from '../config/redis';

export interface LogisticsShadowJobData {
  userId?: string;
  vendorId: string;
  vendorName: string;

  sender: { name: string; phone: string; email: string; address: string };
  receiver: { name: string; phone: string; email: string; address: string };
  packageItems: Array<{
    name: string;
    description: string;
    unit_weight: string;
    unit_amount: string;
    quantity: string;
  }>;

  // Structured payload for the logistics engine (already normalised)
  logisticsRequest: {
    origin: {
      line1: string;
      city: string;
      state: string;
      country: string;
      countryCode: string;
    };
    destination: {
      line1: string;
      city: string;
      state: string;
      country: string;
      countryCode: string;
    };
    packages: Array<{
      description: string;
      weightGrams: number;
      quantity: number;
      declaredValueKobo: number;
    }>;
  };

  // ShipBubble's outcome (already known at enqueue time)
  shipbubble: {
    cheapestPriceNaira: number;
    optionCount: number;
    couriers: Array<{ courier: string; priceNaira: number; eta: string }>;
    durationMs: number;
  };
}

export const logisticsShadowQueue = new Queue<LogisticsShadowJobData, void, string>(
  'logistics-shadow',
  {
    connection: bullmqClient as any,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    },
  },
);
