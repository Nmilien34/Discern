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

import type {
  EntitlementStatus,
  LinkProvider,
  OnboardingBrought,
  OnboardingFamiliarity,
  OnboardingTimeAvailable,
  StageSlug,
  TypeSize,
} from "@discern/shared";
import {
  ENTITLEMENT_STATUSES,
  LINK_PROVIDERS,
  ONBOARDING_BROUGHT,
  ONBOARDING_FAMILIARITY,
  ONBOARDING_TIME_AVAILABLE,
  STAGE_SLUGS,
  TYPE_SIZES,
} from "@discern/shared";
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

/**
 * One completed onboarding step.
 *
 * STEPS, NOT A BOOLEAN, and this is the point of the design. A single
 * `onboardingComplete` flag means that adding a step later either re-runs the
 * whole flow for every existing user or silently skips it for all of them.
 * Recording what was completed and when lets a later change re-run only the
 * new part.
 */
export interface OnboardingStepDocument {
  /** Stable identifier, e.g. "welcome", "chose-stage", "first-carrying". */
  step: string;
  completedAt: Date;
}

export interface UserPreferencesDocument {
  translationId: Types.ObjectId | null;
  /**
   * "HH:MM" in the user's own zone, or null.
   *
   * NULL IS THE DEFAULT AND NULL MEANS SILENCE. There is no daily default and
   * no opt-out — a person who has not chosen a time is never notified. An app
   * whose thesis is that you sit with one thing does not get to interrupt you
   * on a schedule you did not pick.
   */
  notificationTime: string | null;
  /** IANA zone. Without it "8pm" is 8pm somewhere else. */
  timezone: string | null;
  /** Expo/APNs token, or null. Set by the app, cleared when it goes stale. */
  pushToken: string | null;
  /**
   * Should Abigail's own prose be spoken to THIS person?
   *
   * null means "follow the deployment" (SPEAK_REPLIES). true and false are
   * explicit overrides, which is what lets a subset of testers hear her while
   * everyone else reads her — the deployment flag alone is all-or-nothing.
   *
   * A user override can only ever be MORE restrictive than the deployment in
   * one direction: with SPEAK_REPLIES false, true here still enables it, which
   * is the point. With VOICE_ENABLED false, nothing is spoken regardless.
   */
  speakReplies: boolean | null;
  voiceEnabled: boolean;
  typeSize: TypeSize;
}

export interface UserDocument extends Document<Types.ObjectId> {
  deviceId: string;
  /**
   * What she calls them, from onboarding screen 3.
   *
   * Separate from `onboardingAnswers.name` on purpose: the answer is what they
   * typed during onboarding, this is what the app uses now. They start equal
   * and diverge the moment someone changes it in Settings.
   */
  name: string | null;
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
  /**
   * What this person has been through, SERVER-SIDE.
   *
   * Not local storage. The whole auth promise of this app is that reinstalling
   * loses nothing — carryings, memory, what she knows about you — and
   * onboarding re-running on a new phone breaks that promise in the first five
   * seconds, before anything good has happened.
   */
  onboarding: OnboardingStepDocument[];
  onboardingAnswers: OnboardingAnswersDocument;
  lastActiveAt: Date;
  /** Enforces at most one notification a day. Null until the first one. */
  lastNotifiedAt: Date | null;
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

export interface OnboardingAnswersDocument {
  name: string | null;
  brought: OnboardingBrought | null;
  vices: StageSlug[];
  firstVice: StageSlug | null;
  situation: string | null;
  person: string | null;
  familiarity: OnboardingFamiliarity | null;
  timeAvailable: OnboardingTimeAvailable | null;
}

const preferencesSchema = new Schema<UserPreferencesDocument>(
  {
    translationId: {
      type: Schema.Types.ObjectId,
      ref: "Translation",
      default: null,
    },
    notificationTime: { type: String, default: null },
    timezone: { type: String, default: null },
    pushToken: { type: String, default: null },
    speakReplies: { type: Boolean, default: null },
    voiceEnabled: { type: Boolean, required: true, default: false },
    typeSize: { type: String, enum: TYPE_SIZES, required: true, default: "medium" },
  },
  { _id: false },
);

/**
 * WHAT SOMEONE SAID DURING ONBOARDING. PRODUCT DATA, NOT JOURNAL DATA.
 *
 * The distinction is written here rather than left to inference, because both
 * are things a person typed about themselves and only one of them never leaves.
 *
 *   The JOURNAL is what someone writes for themselves. It never reaches
 *   Abigail — not summarised, not retrieved, not referenced, not embedded — and
 *   that is enforced by a lint rule, a models barrel that will not export it,
 *   and a test written before the feature. See models/journal-entry.model.ts.
 *
 *   THESE are what someone told the product in order to be given the right
 *   thing. They MAY inform the path, the starting virtue, and Abigail's
 *   context. That is what they are for, and onboarding screen 9 says so out
 *   loud: "She will have it when you talk."
 *
 * So the journal's rules do not extend here and were never meant to. What DOES
 * extend is sensitivity: round 15 ruled the vice selection sensitive, so it is
 * listed under "what she remembers", it is deletable there, and it carries a
 * privacy-policy line.
 *
 * ACCUMULATES, never replaced wholesale. Someone who quits at screen 9 and
 * comes back has nine screens of answers, and a later screen cannot clear an
 * earlier answer by omitting it.
 */
const onboardingAnswersSchema = new Schema<OnboardingAnswersDocument>(
  {
    name: { type: String, default: null, trim: true },
    brought: { type: String, enum: ONBOARDING_BROUGHT, default: null },
    // Stage slugs, not vice words: `resolveStartingStage()` already takes these.
    vices: { type: [String], enum: STAGE_SLUGS, required: true, default: [] },
    firstVice: { type: String, enum: STAGE_SLUGS, default: null },
    situation: { type: String, default: null },
    person: { type: String, default: null, trim: true },
    familiarity: { type: String, enum: ONBOARDING_FAMILIARITY, default: null },
    timeAvailable: { type: String, enum: ONBOARDING_TIME_AVAILABLE, default: null },
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
    name: { type: String, default: null, trim: true },
    preferences: { type: preferencesSchema, required: true, default: () => ({}) },
    onboardingAnswers: {
      type: onboardingAnswersSchema,
      required: true,
      default: () => ({}),
    },
    abigailConversationsStarted: { type: Number, required: true, default: 0, min: 0 },
    mergedIntoUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    onboarding: {
      type: [
        new Schema(
          {
            step: { type: String, required: true, trim: true },
            completedAt: { type: Date, required: true, default: () => new Date() },
          },
          { _id: false },
        ),
      ],
      required: true,
      default: [],
    },
    lastActiveAt: { type: Date, required: true, default: () => new Date() },
    lastNotifiedAt: { type: Date, default: null },
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
