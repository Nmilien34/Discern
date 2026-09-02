// ARCHITECTURE.md §6, `users`.
//
// Anonymous-first. A user exists from first launch with nothing but a device id
// (§10 decision 2), because the Bible reader and author navigation are free
// forever and putting a signup wall in front of them would cost installs for
// nothing.
//
// ONE USER DOCUMENT PER PERSON, FOR THE LIFE OF THE ACCOUNT. Linking attaches an
// account identity to the EXISTING document rather than creating a second one —
// carryings, conversations and memory all hang off this _id, and the one
// unforgivable bug in this app is losing them. See services/users/account-link.

import type { EntitlementStatus, LinkProvider } from "@discern/shared";
import { ENTITLEMENT_STATUSES, LINK_PROVIDERS } from "@discern/shared";
import mongoose, { Schema } from "mongoose";
import type { Document, Types } from "mongoose";

import { applyApiTransforms } from "./model-utils";

export interface UserEntitlementDocument {
  status: EntitlementStatus;
  expiresAt: Date | null;
  willRenew: boolean;
  /** RevenueCat's stable customer id, once one is known to be usable. */
  revenueCatId?: string;
  /**
   * Every app-user id RevenueCat has used for this person.
   *
   * A device-id-first app produces several: the anonymous SDK id, the id after
   * `logIn`, and any aliases from a transfer. A webhook can arrive under any of
   * them, so lookup has to consider all of them or a purchase silently lands on
   * nobody.
   */
  revenueCatAppUserIds: string[];
  lastVerifiedAt: Date | null;
  /** Three states, never a boolean. See middleware/require-entitlement. */
  verificationState: "verified" | "stale" | "unavailable";
}

export interface UserPreferencesDocument {
  translationId: Types.ObjectId | null;
  /** "HH:MM" in the user's own zone. Phase 8 schedules against it. */
  notificationTime: string | null;
  voiceEnabled: boolean;
}

export interface UserDocument extends Document<Types.ObjectId> {
  deviceId: string;
  /** Provider subject, once linked. Null while anonymous. */
  accountId: string | null;
  accountProvider: LinkProvider | null;
  email: string | null;
  entitlement: UserEntitlementDocument;
  currentStageSlug: string | null;
  preferences: UserPreferencesDocument;
  /**
   * Abigail conversations this user has started, ever.
   *
   * Extension beyond ARCHITECTURE.md §6, and deliberately a counter on the user
   * rather than a count of the conversations collection. Two reasons: the
   * entitlement gate ships in Phase 4 and the conversations collection does not
   * exist until Phase 6, and a monotonic counter is not affected by a
   * conversation being deleted later. The free allowance is about how many times
   * someone has BEGUN, not how many records currently exist.
   */
  abigailConversationsStarted: number;
  /**
   * Set when this document was merged INTO another during account linking.
   *
   * The document is kept rather than deleted: a token minted against it may
   * still be in flight on a device, and a merged user needs to resolve to its
   * survivor rather than to "user no longer exists".
   */
  mergedIntoUserId: Types.ObjectId | null;
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const entitlementSchema = new Schema<UserEntitlementDocument>(
  {
    status: {
      type: String,
      enum: ENTITLEMENT_STATUSES,
      required: true,
      default: "free",
      index: true,
    },
    expiresAt: { type: Date, default: null },
    willRenew: { type: Boolean, required: true, default: false },
    revenueCatId: { type: String, trim: true },
    revenueCatAppUserIds: { type: [String], default: [] },
    lastVerifiedAt: { type: Date, default: null },
    verificationState: {
      type: String,
      enum: ["verified", "stale", "unavailable"],
      required: true,
      default: "verified",
    },
  },
  { _id: false },
);

const preferencesSchema = new Schema<UserPreferencesDocument>(
  {
    translationId: {
      type: Schema.Types.ObjectId,
      ref: "Translation",
      default: null,
    },
    notificationTime: { type: String, default: null },
    voiceEnabled: { type: Boolean, required: true, default: false },
  },
  { _id: false },
);

const userSchema = new Schema<UserDocument>(
  {
    deviceId: { type: String, required: true, trim: true },
    accountId: { type: String, default: null, trim: true },
    accountProvider: { type: String, enum: [...LINK_PROVIDERS, null], default: null },
    email: { type: String, default: null, trim: true, lowercase: true },
    entitlement: { type: entitlementSchema, required: true, default: () => ({}) },
    currentStageSlug: { type: String, default: null },
    preferences: { type: preferencesSchema, required: true, default: () => ({}) },
    abigailConversationsStarted: { type: Number, required: true, default: 0, min: 0 },
    mergedIntoUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    lastActiveAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true, versionKey: false },
);

userSchema.index({ deviceId: 1 }, { unique: true });

// Partial unique: an account identity may be claimed by at most one user, but
// the vast majority of users are anonymous and have null here. A plain unique
// index would allow exactly one null and reject every subsequent device.
userSchema.index(
  { accountProvider: 1, accountId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      accountId: { $type: "string" },
      accountProvider: { $type: "string" },
    },
  },
);
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string" } } },
);
userSchema.index({ "entitlement.revenueCatAppUserIds": 1 });
userSchema.index({ "entitlement.revenueCatId": 1 }, { sparse: true });
userSchema.index({ mergedIntoUserId: 1 }, { sparse: true });

// No soft-delete middleware. A merged user must stay findable by id — a token
// minted against it can still be in flight — and a pre(/^find/) hook that hid it
// would turn "your account moved" into "your account is gone".
applyApiTransforms(userSchema);

export const UserModel = mongoose.model<UserDocument>("User", userSchema);
