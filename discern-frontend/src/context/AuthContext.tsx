// Identity, from first launch. There is no signup wall (ARCHITECTURE.md §10
// decision 2), so this runs on boot with nothing asked of the person.
//
// The device id is minted once into the keychain and POST /v1/auth/device is
// IDEMPOTENT on it, so registering on every launch resolves the same account
// rather than making a new one. That property is what makes it safe to do this
// unconditionally instead of only when a token is missing — and doing it
// unconditionally is what recovers a session whose token expired.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { api } from "../services/api";
import {
  clearAuth,
  getOrCreateDeviceId,
  getStoredToken,
  getStoredUserId,
  setStoredAuth,
} from "../services/storage";

interface AuthContextValue {
  /** Null until the first registration completes. */
  userId: string | null;
  deviceId: string | null;
  isAuthenticated: boolean;
  /** True while the very first registration is in flight. */
  loading: boolean;
  /** Set when registration failed. The app is unusable until it succeeds. */
  error: string | null;
  register(): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const register = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const id = await getOrCreateDeviceId();
      setDeviceId(id);

      // Adopt any stored token FIRST, so a 401 during registration is a real
      // 401 and not "we forgot to send the header".
      const stored = await getStoredToken();
      if (stored) {
        api.setAuthToken(stored);
        setUserId(await getStoredUserId());
      }

      const auth = await api.registerDevice(id);
      api.setAuthToken(auth.token);
      await setStoredAuth(auth.token, auth.userId);
      setUserId(auth.userId);
      console.log(
        `[auth] device registered — userId ${auth.userId}, created=${auth.created}`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not register this device.");
      console.warn("[auth] device registration failed", cause);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    await clearAuth();
    api.setAuthToken(null);
    setUserId(null);
  }, []);

  useEffect(() => {
    void register();
  }, [register]);

  // A 401 from ANY request lands here once, rather than at every call site.
  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      setUserId(null);
      void clearAuth();
    });
    return () => api.setUnauthorizedHandler(undefined);
  }, []);

  const value = useMemo(
    () => ({
      userId,
      deviceId,
      isAuthenticated: Boolean(userId),
      loading,
      error,
      register,
      signOut,
    }),
    [userId, deviceId, loading, error, register, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
