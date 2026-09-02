// Dev script: enqueue a synthetic shadow-quote job to prove the parent ↔
// logistics wiring end-to-end. Run with:
//   npx dotenv -e .env -- npx ts-node scripts/test-shadow.ts
// Verify by watching the parent server log for:
//   [LogisticsShadow] vendor=... winner=... shipbubble=₦... ours=₦...
// and querying the logistics engine's admin /quotes page for a fresh row.

import 'dotenv/config';
import mongoose from 'mongoose';
import { logisticsShadowQueue } from '../src/queues/logistics-shadow.queue';

async function main() {
  // vendorId in the Mongo shadow-log model is a ref → needs a valid ObjectId
  // string. Synthesize one so we don't need a real vendor row for the smoke.
  const fakeVendorId = new mongoose.Types.ObjectId().toString();
  const job = await logisticsShadowQueue.add('shadow-quote', {
    vendorId: fakeVendorId,
    vendorName: 'Smoke Test Vendor',
    sender: {
      name: 'Adaeze Okafor',
      phone: '+2348012345678',
      email: 'sender@example.com',
      address: '1 Adeola Odeku Street, Victoria Island, Lagos',
    },
    receiver: {
      name: 'Chidi Johnson',
      phone: '+2348087654321',
      email: 'recipient@example.com',
      address: '5 Lekki Road, Lekki, Lagos',
    },
    packageItems: [
      {
        name: 'Test Parcel',
        description: 'Smoke test parcel',
        unit_weight: '1',
        unit_amount: '5000',
        quantity: '1',
      },
    ],
    logisticsRequest: {
      origin: {
        line1: '1 Adeola Odeku Street',
        city: 'Victoria Island',
        state: 'Lagos',
        country: 'Nigeria',
        countryCode: 'NG',
      },
      destination: {
        line1: '5 Lekki Road',
        city: 'Lekki',
        state: 'Lagos',
        country: 'Nigeria',
        countryCode: 'NG',
      },
      packages: [
        {
          description: 'Test Parcel',
          weightGrams: 1000,
          quantity: 1,
          declaredValueKobo: 500000,
        },
      ],
    },
    shipbubble: {
      cheapestPriceNaira: 1800,
      optionCount: 3,
      couriers: [
        { courier: 'GIG Logistics', priceNaira: 1800, eta: '3-5 days' },
        { courier: 'DHL', priceNaira: 4500, eta: '1-2 days' },
      ],
      durationMs: 0,
    },
  });
  console.log(`Enqueued job id=${job.id}. Watch parent log + logistics admin /quotes for confirmation.`);
  await logisticsShadowQueue.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed to enqueue:', err);
  process.exit(1);
});
