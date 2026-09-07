// The device identity and the bearer token, in the KEYCHAIN.
//
// A DEPARTURE FROM BOTH REFERENCES, ON PURPOSE. Pepta and Leanient both keep
// their auth token in AsyncStorage, which on iOS is an unencrypted file in the
// app container. That is defensible for them and it is not here: Discern's
// device id IS the account (there is no signup wall — ARCHITECTURE.md §10
// decision 2), so anyone holding it holds every conversation this person has
// had, what they are carrying, and what stage Abigail named. There is no
// password behind it to re-challenge with.
//
// SecureStore puts both in the keychain instead. It is also why the device id
// is generated and stored rather than read from the OS: `identifierForVendor`
// resets when the last app from a vendor is deleted, which would silently
// orphan someone's whole history on a reinstall-after-uninstall.
//
// KEYCHAIN ITEMS SURVIVE UNINSTALL on iOS, which is the behaviour we want —
// the same person reinstalling gets their account back — and is worth knowing
// when a "fresh install" during testing is not fresh at all. `clearAuth()` is
// the only way back to zero.

import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const DEVICE_ID_KEY = "discern.deviceId.v1";
const TOKEN_KEY = "discern.authToken.v1";
const USER_ID_KEY = "discern.userId.v1";

/**
 * This install's device id, minting one on first launch.
 *
 * IDEMPOTENT AND STABLE. POST /v1/auth/device is idempotent on this value, so a
 * retried registration, a flaky network or a reinstall resolves to the SAME
 * account rather than orphaning everything behind a second one — but only if
 * this function keeps returning the same string, which is the whole reason it
 * is written once and read forever after.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  // DEV ONLY, AND GATED ON __DEV__ AS WELL AS THE VARIABLE.
  //
  // There is no way to buy a subscription for an app that is not in a store
  // yet, so every gated screen is unreachable on a fresh install — it registers
  // as `free` and hits the paywall, correctly. `npm run testers` provisions
  // accounts that already hold a trialing entitlement, and this lets a
  // development build adopt one by name.
  //
  // It goes through POST /v1/auth/device like everything else. That endpoint is
  // idempotent on the device id, so naming an existing tester RESOLVES that
  // account rather than creating anything — no entitlement is granted here and
  // nothing writes to the database. The double gate is deliberate: a release
  // build ignores this variable even if someone ships one with it set.
  if (__DEV__ && process.env.EXPO_PUBLIC_DEV_DEVICE_ID) {
    return process.env.EXPO_PUBLIC_DEV_DEVICE_ID;
  }

  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;

  // 36 characters, comfortably inside the API's 8-200 bound.
  const deviceId = Crypto.randomUUID();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

export async function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function getStoredUserId(): Promise<string | null> {
  return SecureStore.getItemAsync(USER_ID_KEY);
}

/**
 * Persist the session.
 *
 * Both values are written together because they must move together: a `merged`
 * outcome from POST /v1/auth/link returns a DIFFERENT userId than the caller
 * had, and a client that stores the new token beside the old id is pointing at
 * an account that is no longer its own.
 */
export async function setStoredAuth(token: string, userId: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(USER_ID_KEY, userId);
}

/**
 * Sign out. Leaves the DEVICE ID in place deliberately — it is the identity, so
 * clearing it would abandon the account rather than sign out of it.
 */
export async function clearAuth(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(USER_ID_KEY);
}

/** Abandon the account entirely. Testing only — there is no way back. */
export async function clearEverything(): Promise<void> {
  await clearAuth();
  await SecureStore.deleteItemAsync(DEVICE_ID_KEY);
}
