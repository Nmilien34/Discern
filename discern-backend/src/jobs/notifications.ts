// NOTIFICATIONS. THE RULES ARE IN CODE, NOT IN A COMMENT.
//
// This is the one place the product's thesis becomes visible to someone who is
// not using the app. Get it wrong and Discern is another engagement loop with
// scripture on it.
//
// WHAT A NOTIFICATION IS ABOUT: something the person is CARRYING. "You have
// been sitting with Matthew 5:23-24 since Tuesday." It points at the thing they
// chose, in the state they left it.
//
// WHAT IT IS NEVER ABOUT: coming back. No streaks, no consecutive days, no "you
// haven't opened Discern in a while", no counting anything. The seed ledger is
// append-only with no decay and no absence penalty precisely so that not
// opening the app costs nothing — and a notification that scolds someone for
// three quiet days contradicts that in the one place they can actually see it.
//
// `assertOnBrand` below is a real check, run on every notification before it is
// scheduled. It exists because a rule that lives only in a comment is a rule
// that a future prompt, a future contractor, or a hurried version of me will
// break without noticing.

import { logger } from "../lib/logger";
import { CarryingModel, PassageModel, UserModel } from "../models";
import type { UserDocument } from "../models";

/**
 * Language that must never appear in a notification.
 *
 * Not a style preference — each of these is an engagement mechanic this app is
 * built against, and one shipping by accident would say more about Discern than
 * any amount of copy elsewhere.
 */
const FORBIDDEN = [
  /\bstreak\b/i,
  /\bdon'?t lose\b/i,
  /\bconsecutive\b/i,
  /\bdays? in a row\b/i,
  /\bhaven'?t (opened|been|visited|used)\b/i,
  /\bcome back\b/i,
  /\bmiss(es|ed|ing)? you\b/i,
  /\byou'?re falling behind\b/i,
  /\bkeep it up\b/i,
  /\bcheck ?in\b/i,
  /\bwe'?re waiting\b/i,
  /\bstill (there|with us)\b/i,
];

export class OffBrandNotificationError extends Error {}

/** Throws rather than sends. A wrong notification is worse than none. */
export function assertOnBrand(body: string): void {
  for (const pattern of FORBIDDEN) {
    if (pattern.test(body)) {
      throw new OffBrandNotificationError(
        `Refusing to send a notification matching ${pattern}: "${body}". ` +
          "Notifications are about what someone is carrying, never about " +
          "coming back. See src/jobs/notifications.ts.",
      );
    }
  }
}

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

/** "since Tuesday" while it is recent, a count once that stops meaning anything. */
function sincePhrase(addedAt: Date): string {
  const days = daysSince(addedAt);
  if (days <= 0) return "today";
  if (days === 1) return "since yesterday";
  if (days < 7) {
    return `since ${addedAt.toLocaleDateString("en-GB", { weekday: "long" })}`;
  }
  if (days < 14) return "for a week";
  return `for ${Math.floor(days / 7)} weeks`;
}

export interface Notification {
  title: string;
  body: string;
  carryingId: string;
}

/**
 * What to say to this person tonight, or nothing.
 *
 * SILENCE IS A CORRECT OUTCOME and the common one. No carrying, nothing worth
 * saying, already spoken to today — all return null, and null is not a failure
 * to be worked around.
 */
export async function composeNotification(
  user: UserDocument,
): Promise<Notification | null> {
  const carryings = await CarryingModel.find({
    userId: user._id,
    releasedAt: null,
  })
    .sort({ addedAt: 1 })
    .lean();

  if (carryings.length === 0) return null;

  // The oldest one. It is the thing that has been sat with longest, which is
  // the whole point — not the newest, which would reward adding things.
  const carrying = carryings[0];
  if (!carrying) return null;

  const passage = await PassageModel.findById(carrying.refId)
    .select("reference summary")
    .lean();

  // The carrying stores refId; the human-readable reference lives on the
  // passage, which is why it is fetched rather than denormalised.
  const reference = passage?.reference;
  if (!reference) return null;

  const body = carrying.why
    ? `You have been sitting with ${reference} ${sincePhrase(carrying.addedAt)}. ${carrying.why}`
    : `You have been sitting with ${reference} ${sincePhrase(carrying.addedAt)}.`;

  assertOnBrand(body);

  return { title: reference, body, carryingId: String(carrying._id) };
}

/**
 * Is it the minute this person asked for, in THEIR zone?
 *
 * A user with no `notificationTime` is never due. That is the shipped default
 * and it is why there is no opt-out: there is nothing to opt out of.
 */
export function isDue(user: UserDocument, now = new Date()): boolean {
  const time = user.preferences.notificationTime;
  if (!time) return false;
  if (!user.preferences.pushToken) return false;

  const zone = user.preferences.timezone ?? "UTC";

  let local: string;
  try {
    local = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
  } catch {
    // An unknown zone means we do not know what "8pm" means for them, and
    // guessing would notify someone in the middle of the night.
    logger.warn({ userId: String(user._id), zone }, "unknown timezone; not notifying");
    return false;
  }

  return local === time;
}

/** Sends, and records that it happened so nobody gets two in a day. */
export async function markNotified(userId: string): Promise<void> {
  await UserModel.updateOne(
    { _id: userId },
    { $set: { lastNotifiedAt: new Date() } },
  );
}

/** At most one a day, enforced here rather than trusted to the scheduler. */
export function alreadyNotifiedToday(user: UserDocument): boolean {
  const last = (user as UserDocument & { lastNotifiedAt?: Date | null })
    .lastNotifiedAt;
  if (!last) return false;
  return daysSince(last) < 1;
}
