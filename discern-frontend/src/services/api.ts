// The API client. One class, one place that knows about headers, timeouts,
// retries and the error envelope — Pepta's shape, via Leanient.
//
// EVERY RESPONSE IS PARSED AGAINST A SCHEMA FROM @discern/shared. Not typed
// against, parsed: the schemas are strict, so a field the backend adds or
// renames fails HERE, loudly, on one call, instead of surfacing three screens
// later as undefined. That is the entire reason the shared workspace exists,
// and the reason it was worth fixing `meResponseSchema` before writing this
// file — it did not describe what GET /v1/me has been sending since Phase 8.

import {
  booksListResponseSchema,
  carryingSchema,
  carryingsListResponseSchema,
  chapterResponseSchema,
  conversationDetailResponseSchema,
  conversationsListResponseSchema,
  createCarryingRequestSchema,
  currentStageResponseSchema,
  meResponseSchema,
  notificationPreferencesResponseSchema,
  onboardingResponseSchema,
  passageAudioResponseSchema,
  passageResponseSchema,
  productsResponseSchema,
  seedResponseSchema,
  stagesListResponseSchema,
  startConversationResponseSchema,
  turnResponseSchema,
  updateCarryingRequestSchema,
  authResponseSchema,
} from "@discern/shared";
import type {
  AuthResponse,
  BooksListResponse,
  Carrying,
  CarryingsListResponse,
  CreateCarryingRequest,
  ChapterResponse,
  ConversationDetailResponse,
  ConversationsListResponse,
  CurrentStageResponse,
  MeResponse,
  NotificationPreferencesRequest,
  NotificationPreferencesResponse,
  OnboardingResponse,
  PassageAudioResponse,
  PassageResponse,
  ProductsResponse,
  SeedResponse,
  StagesListResponse,
  StartConversationResponse,
  TurnResponse,
  UpdateCarryingRequest,
} from "@discern/shared";

import { API_BASE_URL, REQUEST_TIMEOUT_MS, RETRY_DELAY_MS } from "../config";
import { apiErrorFrom, ApiError, ResponseParseError } from "./apiError";

/** The subset of a zod schema this file needs. Avoids importing zod itself. */
interface ResponseSchema<T> {
  parse(value: unknown): T;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

class DiscernApi {
  private authToken: string | null = null;
  private onUnauthorized?: () => void;

  /** AuthContext registers this so a 401 anywhere signs the UI out once. */
  public setUnauthorizedHandler(handler: (() => void) | undefined): void {
    this.onUnauthorized = handler;
  }

  public setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  public getAuthToken(): string | null {
    return this.authToken;
  }

  public headers(extra?: Record<string, string>): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
      ...extra,
    };
  }

  private async fetchOnce<T>(
    path: string,
    schema: ResponseSchema<T>,
    options: RequestInit,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        signal: controller.signal,
        headers: this.headers(options.headers as Record<string, string>),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const error = await apiErrorFrom(response);
      // A stale session must not become a 401 loop. Clearing the token here
      // rather than at each call site means every path gets the same handling.
      if (response.status === 401) {
        this.authToken = null;
        this.onUnauthorized?.();
      }
      throw error;
    }

    // PAST HERE THE REQUEST LANDED. Anything that throws below is us failing to
    // read a reply the server already acted on, which a caller has to be able
    // to tell apart from "it never arrived".
    try {
      const json = (await response.json()) as { data?: unknown };
      if (!json || typeof json !== "object" || !("data" in json)) {
        throw new Error("response was not the { data } envelope");
      }
      return schema.parse(json.data);
    } catch (error) {
      throw new ResponseParseError(response.status, error);
    }
  }

  private async request<T>(
    path: string,
    schema: ResponseSchema<T>,
    options: RequestInit = {},
  ): Promise<T> {
    const method = (options.method ?? "GET").toUpperCase();
    // Only reads retry. Retrying a POST could double-write — and on
    // /v1/abigail/conversations it would start a second conversation.
    const idempotent = method === "GET";

    try {
      return await this.fetchOnce(path, schema, options);
    } catch (error) {
      const deterministic =
        error instanceof ApiError && error.status >= 400 && error.status < 500;
      if (idempotent && !deterministic) {
        await delay(RETRY_DELAY_MS);
        return this.fetchOnce(path, schema, options);
      }
      throw error;
    }
  }

  // ---- identity -----------------------------------------------------------

  /**
   * POST /v1/auth/device — register or resolve this device.
   *
   * Idempotent on `deviceId`, so calling it on every launch is correct and
   * cheap: it resolves the existing account rather than making a new one.
   */
  public registerDevice(deviceId: string): Promise<AuthResponse> {
    return this.request("/v1/auth/device", authResponseSchema, {
      method: "POST",
      body: JSON.stringify({ deviceId }),
    });
  }

  public me(): Promise<MeResponse> {
    return this.request("/v1/me", meResponseSchema);
  }

  public setNotificationPreferences(
    body: NotificationPreferencesRequest,
  ): Promise<NotificationPreferencesResponse> {
    return this.request("/v1/me/notifications", notificationPreferencesResponseSchema, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  /** POST /v1/me/onboarding — records a step. Idempotent per step. */
  public completeOnboardingStep(step: string): Promise<OnboardingResponse> {
    return this.request("/v1/me/onboarding", onboardingResponseSchema, {
      method: "POST",
      body: JSON.stringify({ step }),
    });
  }

  // ---- billing ------------------------------------------------------------

  /** GET /v1/billing/products — IDENTIFIERS ONLY. Prices come from StoreKit. */
  public products(): Promise<ProductsResponse> {
    return this.request("/v1/billing/products", productsResponseSchema);
  }

  // ---- the reader ---------------------------------------------------------

  public books(): Promise<BooksListResponse> {
    return this.request("/v1/bible/books", booksListResponseSchema);
  }

  public chapter(
    bookSlug: string,
    chapter: number,
    translation?: string,
  ): Promise<ChapterResponse> {
    const query = translation ? `?translation=${encodeURIComponent(translation)}` : "";
    return this.request(
      `/v1/bible/books/${encodeURIComponent(bookSlug)}/${chapter}${query}`,
      chapterResponseSchema,
    );
  }

  /** The reference is ONE path segment and must be encoded whole. */
  public passage(reference: string, translation?: string): Promise<PassageResponse> {
    const query = translation ? `?translation=${encodeURIComponent(translation)}` : "";
    return this.request(
      `/v1/bible/passages/${encodeURIComponent(reference)}${query}`,
      passageResponseSchema,
    );
  }

  // ---- the journey --------------------------------------------------------

  public stages(): Promise<StagesListResponse> {
    return this.request("/v1/journey/stages", stagesListResponseSchema);
  }

  public currentStage(): Promise<CurrentStageResponse> {
    return this.request("/v1/journey/stage", currentStageResponseSchema);
  }

  public seed(): Promise<SeedResponse> {
    return this.request("/v1/journey/seed", seedResponseSchema);
  }

  // ---- carryings ----------------------------------------------------------

  /**
   * `releasedLimit` bounds the released page; `releasedTotal` in the response
   * is always the true count. Released carryings are kept forever, so the count
   * keeps growing while the payload does not.
   */
  public carryings(releasedLimit?: number): Promise<CarryingsListResponse> {
    const query =
      releasedLimit === undefined ? "" : `?releasedLimit=${releasedLimit}`;
    return this.request(`/v1/carryings${query}`, carryingsListResponseSchema);
  }

  /** 409 at the three-carrying cap, with the numbers, so the app can offer a release. */
  public addCarrying(body: CreateCarryingRequest): Promise<Carrying> {
    return this.request("/v1/carryings", carryingSchema, {
      method: "POST",
      body: JSON.stringify(createCarryingRequestSchema.parse(body)),
    });
  }

  public updateCarrying(
    id: string,
    body: UpdateCarryingRequest,
  ): Promise<Carrying> {
    return this.request(`/v1/carryings/${encodeURIComponent(id)}`, carryingSchema, {
      method: "PATCH",
      body: JSON.stringify(updateCarryingRequestSchema.parse(body)),
    });
  }

  /**
   * GET /v1/carryings/:id/audio — the passage read aloud.
   *
   * The url is SIGNED AND EXPIRING. Call this when the person presses play and
   * do not persist what comes back; a stored url starts failing silently some
   * time after it was issued.
   */
  public carryingAudio(
    id: string,
    translation?: string,
  ): Promise<PassageAudioResponse> {
    const query = translation ? `?translation=${encodeURIComponent(translation)}` : "";
    return this.request(
      `/v1/carryings/${encodeURIComponent(id)}/audio${query}`,
      passageAudioResponseSchema,
    );
  }

  // ---- Abigail ------------------------------------------------------------

  public startConversation(
    mode: "text" | "voice" = "text",
  ): Promise<StartConversationResponse> {
    return this.request("/v1/abigail/conversations", startConversationResponseSchema, {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
  }

  public conversations(
    options: { limit?: number; before?: string } = {},
  ): Promise<ConversationsListResponse> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.before) params.set("before", options.before);
    const query = params.toString() ? `?${params.toString()}` : "";

    return this.request(
      `/v1/abigail/conversations${query}`,
      conversationsListResponseSchema,
    );
  }

  public conversation(id: string): Promise<ConversationDetailResponse> {
    return this.request(
      `/v1/abigail/conversations/${encodeURIComponent(id)}`,
      conversationDetailResponseSchema,
    );
  }

  /**
   * The whole turn as one body, after the wait.
   *
   * PREFER `streamTurn` (services/stream.ts). This one shows a blank screen for
   * 35-75 seconds and cannot deliver audio, which arrives per sentence.
   */
  public sendMessage(
    conversationId: string,
    content: string,
  ): Promise<TurnResponse> {
    return this.request(
      `/v1/abigail/conversations/${encodeURIComponent(conversationId)}/messages`,
      turnResponseSchema,
      { method: "POST", body: JSON.stringify({ content }) },
    );
  }
}

export const api = new DiscernApi();
