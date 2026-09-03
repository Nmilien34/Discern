// THE NOTIFICATION RULES.
//
// These are the one part of the product a person sees without opening the app,
// and the rules are not stylistic. The seed ledger is append-only with no decay
// and no absence penalty so that not opening Discern costs nothing; a
// notification that counts consecutive days contradicts that in the only place
// the user can actually see it.
//
// A rule that lives in a comment is a rule that gets broken by a future prompt
// change nobody connects to this file. So the guard is code, and this is the
// test that keeps it honest.

import { describe, expect, it } from "vitest";

import {
  OffBrandNotificationError,
  assertOnBrand,
  isDue,
} from "../jobs/notifications";
import type { UserDocument } from "../models";

function userWith(preferences: Partial<UserDocument["preferences"]>): UserDocument {
  return {
    _id: "u1",
    preferences: {
      translationId: null,
      notificationTime: null,
      timezone: null,
      pushToken: null,
      voiceEnabled: false,
      ...preferences,
    },
  } as unknown as UserDocument;
}

describe("assertOnBrand", () => {
  it("allows a notification about what someone is carrying", () => {
    expect(() =>
      assertOnBrand("You have been sitting with Matthew 5:23-24 since Tuesday."),
    ).not.toThrow();
  });

  // Each of these is an engagement mechanic this app is built against.
  const forbidden = [
    "Don't lose your streak!",
    "You haven't opened Discern in 3 days.",
    "That's 7 consecutive days — keep it up!",
    "You're on a 5 days in a row run.",
    "We miss you.",
    "Come back and see what's waiting.",
    "Time for your daily check in.",
  ];

  for (const body of forbidden) {
    it(`REFUSES: ${body}`, () => {
      expect(() => assertOnBrand(body)).toThrow(OffBrandNotificationError);
    });
  }

  it("names the file, so whoever trips it knows where the rule lives", () => {
    expect(() => assertOnBrand("Don't lose your streak")).toThrow(
      /notifications\.ts/,
    );
  });
});

describe("isDue", () => {
  // 20:00 UTC exactly.
  const at8pmUtc = new Date("2026-09-03T20:00:00Z");

  it("NEVER fires for someone who has not chosen a time", () => {
    // The shipped default. There is no opt-out because there is nothing to
    // opt out of.
    expect(isDue(userWith({ pushToken: "tok" }), at8pmUtc)).toBe(false);
  });

  it("never fires without a push token, however keen the preference", () => {
    expect(
      isDue(userWith({ notificationTime: "20:00", timezone: "UTC" }), at8pmUtc),
    ).toBe(false);
  });

  it("fires at the chosen minute", () => {
    expect(
      isDue(
        userWith({ notificationTime: "20:00", timezone: "UTC", pushToken: "tok" }),
        at8pmUtc,
      ),
    ).toBe(true);
  });

  it("uses THEIR zone, not the server's", () => {
    // 20:00 UTC is 16:00 in New York, so a New Yorker who asked for 20:00 is
    // not due — and a server-local check would have woken them at four.
    const newYorker = userWith({
      notificationTime: "20:00",
      timezone: "America/New_York",
      pushToken: "tok",
    });
    expect(isDue(newYorker, at8pmUtc)).toBe(false);

    // Their 20:00 is midnight UTC.
    expect(isDue(newYorker, new Date("2026-09-04T00:00:00Z"))).toBe(true);
  });

  it("stays silent on an unknown timezone rather than guessing", () => {
    // Guessing means notifying somebody in the middle of the night.
    expect(
      isDue(
        userWith({
          notificationTime: "20:00",
          timezone: "Mars/Olympus_Mons",
          pushToken: "tok",
        }),
        at8pmUtc,
      ),
    ).toBe(false);
  });

  it("does not fire a minute early or a minute late", () => {
    const u = userWith({ notificationTime: "20:00", timezone: "UTC", pushToken: "tok" });
    expect(isDue(u, new Date("2026-09-03T19:59:00Z"))).toBe(false);
    expect(isDue(u, new Date("2026-09-03T20:01:00Z"))).toBe(false);
  });
});
