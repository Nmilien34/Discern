import type { NextFunction, Request, Response } from "express";

import { verifyToken } from "../auth/tokens";
import { UnauthorizedError } from "../lib/errors";
import { resolveSurvivingUser } from "../services/users/account-link.service";

/** Verifies the bearer token and sets `req.user`. Does not hit the database. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header("authorization");

  if (!header?.startsWith("Bearer ")) {
    next(new UnauthorizedError("Missing bearer token"));
    return;
  }

  try {
    const payload = verifyToken(header.slice("Bearer ".length).trim());
    req.user = { id: payload.sub };
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Loads the full user onto `req.currentUser`, FOLLOWING MERGE POINTERS.
 *
 * Separate from requireAuth on purpose (Corner's split): most routes do not need
 * the document, and every authenticated request should not pay for a lookup.
 *
 * The merge-following is what makes an old device keep working. A token minted
 * before the user was absorbed into an account names an id that still exists but
 * is no longer the identity; resolving through `mergedIntoUserId` means the old
 * phone continues to work rather than reporting the account gone.
 */
export async function loadUser(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      next(new UnauthorizedError("Authentication required"));
      return;
    }

    const user = await resolveSurvivingUser(req.user.id);

    if (!user) {
      next(new UnauthorizedError("User no longer exists"));
      return;
    }

    req.currentUser = user;
    // Keep req.user.id pointing at the identity that actually owns the data.
    req.user.id = String(user._id);
    next();
  } catch (error) {
    next(error);
  }
}
