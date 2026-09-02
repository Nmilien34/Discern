import jwt from "jsonwebtoken";

import { env } from "../config/env";
import { UnauthorizedError } from "../lib/errors";

export interface TokenPayload {
  sub: string;
}

/** Matches Corner and Pepta: HS256, subject is the user id, configurable expiry. */
export function issueToken(userId: string): string {
  return jwt.sign({} satisfies Record<string, never>, env.JWT_SECRET, {
    subject: userId,
    algorithm: "HS256",
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });

    if (typeof decoded === "string" || !decoded.sub) {
      throw new UnauthorizedError("Malformed token");
    }

    return { sub: decoded.sub };
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    throw new UnauthorizedError("Invalid or expired token");
  }
}
