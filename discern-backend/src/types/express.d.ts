import type { UserDocument } from "../models/user.model";

declare global {
  namespace Express {
    interface Request {
      /** Set by requestLogger. Present on every request, echoed as x-request-id. */
      requestId: string;
      /** Set by requireAuth. `id` is the SURVIVING user id once loadUser has run. */
      user?: { id: string };
      /** Set by loadUser only. Routes that gate on entitlement opt in. */
      currentUser?: UserDocument;
    }
  }
}

export {};
