// models/LogisticsShadowLog.ts
//
// One row per shadow comparison between ShipBubble (the real flow) and the new
// VendorSpot Logistics engine. Recorded during checkout rate fetch (Phase 3.1).
// This collection is a read-only research artefact — no application logic
// depends on it. Later we'll aggregate it into "we're cheaper N% of the time".

import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ILogisticsShadowLog extends Document {
  // Context — who was this for
  userId?: Types.ObjectId;   // the buyer initiating checkout (may be null for logged-out flows)
  vendorId: Types.ObjectId;   // the vendor being quoted
  vendorName: string;

  // Request snapshot — enough to reproduce
  sender: { name: string; phone: string; email: string; address: string };
  receiver: { name: string; phone: string; email: string; address: string };
  packageItems: Array<{ name: string; description: string; unit_weight: string; unit_amount: string; quantity: string }>;

  // ShipBubble outcome (already known when this row is written — enqueue is post-success)
  shipbubble: {
    cheapestPriceNaira: number;
    optionCount: number;
    couriers: Array<{ courier: string; priceNaira: number; eta: string }>;
    durationMs: number;
  };

  // VendorSpot Logistics outcome
  ourResult: {
    ok: boolean;
    cheapestPriceKobo?: number;
    optionCount?: number;
    quoteId?: string;                   // FK-in-spirit into vendorspot-logistics DB
    options?: Array<{ carrier: string; priceKobo: number; etaHours: number | null }>;
    unavailable?: Array<{ carrier: string; reason: string }>;
    error?: string;
    errorCategory?: string;
    durationMs: number;
  };

  // Derived
  winner?: 'shipbubble' | 'us' | 'tie' | 'ours_failed';
  priceDeltaNaira?: number;  // our best - shipbubble best (negative = we're cheaper)

  createdAt: Date;
}

const LogisticsShadowLogSchema = new Schema<ILogisticsShadowLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    vendorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vendorName: { type: String, required: true },

    sender: {
      name: String,
      phone: String,
      email: String,
      address: String,
    },
    receiver: {
      name: String,
      phone: String,
      email: String,
      address: String,
    },
    packageItems: [
      {
        name: String,
        description: String,
        unit_weight: String,
        unit_amount: String,
        quantity: String,
      },
    ],

    shipbubble: {
      cheapestPriceNaira: Number,
      optionCount: Number,
      couriers: [
        {
          courier: String,
          priceNaira: Number,
          eta: String,
        },
      ],
      durationMs: Number,
    },

    ourResult: {
      ok: Boolean,
      cheapestPriceKobo: Number,
      optionCount: Number,
      quoteId: String,
      options: [
        {
          carrier: String,
          priceKobo: Number,
          etaHours: Number,
        },
      ],
      unavailable: [
        {
          carrier: String,
          reason: String,
        },
      ],
      error: String,
      errorCategory: String,
      durationMs: Number,
    },

    winner: { type: String, enum: ['shipbubble', 'us', 'tie', 'ours_failed'] },
    priceDeltaNaira: Number,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

LogisticsShadowLogSchema.index({ createdAt: -1 });
LogisticsShadowLogSchema.index({ winner: 1, createdAt: -1 });

export const LogisticsShadowLog = mongoose.model<ILogisticsShadowLog>(
  'LogisticsShadowLog',
  LogisticsShadowLogSchema,
);
