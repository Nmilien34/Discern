// RevenueCat idempotency record AND durable payment receipt, in one collection.
//
// Ported from Pepta via Corner's CONVENTIONS.md "Payments and durable receipts".
// Two properties matter and both are easy to get wrong:
//
// NO TTL. This is financial evidence. Refunds, disputes and chargebacks arrive
// months after the event, and an expired receipt is an unanswerable question.
//
// WRITTEN LAST. The receipt proves processing COMPLETED; it is never a
// pre-work reservation. If entitlement work fails halfway, no receipt exists,
// and RevenueCat's retry re-applies the event rather than finding a marker
// saying "already done" for work that never finished. The unique index is what
// resolves the concurrent-duplicate case that ordering leaves open.

import mongoose, { Schema } from "mongoose";
import type { Document, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

export interface ProcessedWebhookEventDocument extends Document<Types.ObjectId> {
  provider: "revenuecat";
  /** Provider's own event id. The idempotency key. */
  eventId: string;
  eventType: string;
  /** Null when the event named nobody this deployment knows. */
  userId: Types.ObjectId | null;
  appUserId: string | null;
  revenueCatCustomerId: string | null;
  productId: string | null;
  transactionId: string | null;
  environment: string | null;
  store: string | null;
  periodType: string | null;
  priceInPurchasedCurrency: number | null;
  currency: string | null;
  /** True when the event changed entitlement; false for acknowledged no-ops. */
  mutatedEntitlement: boolean;
  /**
   * Set when the local user reference is cleared on account deletion.
   *
   * Deleting an account must not erase the evidence needed to answer a refund.
   * The user link goes; the provider transaction core stays.
   */
  detachedAt: Date | null;
  processedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const processedWebhookEventSchema = new Schema<ProcessedWebhookEventDocument>(
  {
    provider: { type: String, required: true, default: "revenuecat" },
    eventId: { type: String, required: true, trim: true },
    eventType: { type: String, required: true, trim: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    appUserId: { type: String, default: null, trim: true },
    revenueCatCustomerId: { type: String, default: null, trim: true },
    productId: { type: String, default: null, trim: true },
    transactionId: { type: String, default: null, trim: true },
    environment: { type: String, default: null, trim: true },
    store: { type: String, default: null, trim: true },
    periodType: { type: String, default: null, trim: true },
    priceInPurchasedCurrency: { type: Number, default: null },
    currency: { type: String, default: null, trim: true },
    mutatedEntitlement: { type: Boolean, required: true, default: false },
    detachedAt: { type: Date, default: null },
    processedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true, versionKey: false },
);

// The idempotency key. Two workers processing the same retried delivery race
// here rather than both applying it.
processedWebhookEventSchema.index(
  { provider: 1, eventId: 1 },
  { unique: true },
);
processedWebhookEventSchema.index({ userId: 1, processedAt: -1 });
processedWebhookEventSchema.index({ transactionId: 1 }, { sparse: true });

applyApiTransforms(processedWebhookEventSchema);

export const ProcessedWebhookEventModel =
  mongoose.model<ProcessedWebhookEventDocument>(
    "ProcessedWebhookEvent",
    processedWebhookEventSchema,
  );
