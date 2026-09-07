// Abigail's streamed turn, over Server-Sent Events.
//
// WHY XMLHttpRequest AND NOT fetch OR EventSource.
//
//   EventSource  is GET-only and cannot send a body or an Authorization
//                header. This endpoint is a POST carrying the message, behind
//                a bearer token. It was never an option.
//   fetch        in React Native is a whatwg-fetch polyfill over XHR, and its
//                Response has NO readable `body`. `await response.text()`
//                resolves once, at the end — which is the exact opposite of
//                streaming and would reintroduce the blank minute.
//
// XHR is what is left, and it is genuinely the right primitive: React Native
// exposes `responseText` incrementally during `onprogress`, so the parser below
// just tracks how much it has already consumed. Every RN SSE library does this;
// there is no reason to take a dependency for forty lines.
//
// THE THREE EVENTS THE BRIEF NAMES, AND WHY `restart` IS THE DANGEROUS ONE:
//
//   progress   what she is doing. Rounds 1-3 emit no reply text at all, so
//              without these a person watches nothing happen for most of a
//              minute.
//   token      a delta of the reply.
//   restart    THE REPLY SO FAR HAS BEEN THROWN AWAY — grounding failed, or
//              the two-passage cap fired. It arrives as a `progress` event and
//              it is not advisory. A client that keeps appending after one
//              renders a reply that is half of something she discarded and
//              half of what she actually said, which is a sentence nobody
//              wrote. `onRestart` below exists to make discarding the buffer
//              the obvious thing to do.

import {
  turnDoneEventSchema,
  turnProgressSchema,
  turnStreamErrorSchema,
  turnTokenSchema,
} from "@discern/shared";
import type { TurnDoneEvent, TurnProgress } from "@discern/shared";

import { API_BASE_URL } from "../config";
import { api } from "./api";

export interface StreamHandlers {
  /** Real work, as it happens. Never emitted on a timer. */
  onProgress?: (event: TurnProgress) => void;
  /** One delta of her reply. Append to the buffer. */
  onToken?: (text: string) => void;
  /** DISCARD THE BUFFER. What was rendered is not what she said. */
  onRestart?: (reason: string) => void;
  onDone?: (result: TurnDoneEvent) => void;
  /**
   * The stream is committed with a 200 before anything can go wrong, so a
   * failure cannot be a status code. It arrives here — as a transport error, an
   * `event: error` frame, or a stream that ends without `done`.
   */
  onError?: (message: string) => void;
}

export interface StreamHandle {
  /** Stop listening and drop the request. The server sees the close and stops. */
  cancel(): void;
}

interface ServerSentEvent {
  event: string;
  data: string;
}

/**
 * Split off every COMPLETE event in the buffer, leaving the partial tail.
 *
 * Frames are separated by a blank line. Splitting eagerly on "\n" instead would
 * hand a half-written JSON payload to JSON.parse roughly whenever a reply is
 * long enough to be interesting.
 */
function drainEvents(buffer: string): { events: ServerSentEvent[]; rest: string } {
  const events: ServerSentEvent[] = [];
  const frames = buffer.split("\n\n");
  // The last element is either "" (buffer ended on a boundary) or a partial
  // frame. Either way it is not ours to parse yet.
  const rest = frames.pop() ?? "";

  for (const frame of frames) {
    let event = "message";
    const data: string[] = [];

    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      // A single leading space after the colon is part of the format, not data.
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }

    if (data.length > 0) events.push({ event, data: data.join("\n") });
  }

  return { events, rest };
}

/**
 * Run one turn as a stream.
 *
 * Returns immediately with a handle; everything arrives through the handlers.
 */
export function streamTurn(
  conversationId: string,
  content: string,
  handlers: StreamHandlers,
  options: { speakReply?: boolean } = {},
): StreamHandle {
  const xhr = new XMLHttpRequest();
  const url = `${API_BASE_URL}/v1/abigail/conversations/${encodeURIComponent(
    conversationId,
  )}/messages/stream`;

  let consumed = 0;
  let buffer = "";
  let sawDone = false;
  let cancelled = false;

  const handle = (frame: ServerSentEvent): void => {
    let payload: unknown;
    try {
      payload = JSON.parse(frame.data);
    } catch {
      // A frame we cannot read is not a reason to kill a turn that is working.
      return;
    }

    switch (frame.event) {
      case "progress": {
        const parsed = turnProgressSchema.safeParse(payload);
        if (!parsed.success) return;

        // Surfaced BOTH ways on purpose: as itself, so an activity trail can
        // show it, and through onRestart, so the buffer reset is impossible to
        // miss in a callback that is otherwise just logging.
        handlers.onProgress?.(parsed.data);
        if (parsed.data.type === "restart") handlers.onRestart?.(parsed.data.reason);
        return;
      }
      case "token": {
        const parsed = turnTokenSchema.safeParse(payload);
        if (parsed.success) handlers.onToken?.(parsed.data.text);
        return;
      }
      case "done": {
        const parsed = turnDoneEventSchema.safeParse(payload);
        sawDone = true;
        if (parsed.success) handlers.onDone?.(parsed.data);
        else handlers.onError?.("Her reply finished in a shape this app cannot read.");
        return;
      }
      case "error": {
        const parsed = turnStreamErrorSchema.safeParse(payload);
        sawDone = true;
        handlers.onError?.(
          parsed.success
            ? parsed.data.message
            : "Abigail could not answer just now.",
        );
        return;
      }
      default:
        return;
    }
  };

  const pump = (): void => {
    if (cancelled) return;
    const text = xhr.responseText;
    if (text.length <= consumed) return;

    buffer += text.slice(consumed);
    consumed = text.length;

    const { events, rest } = drainEvents(buffer);
    buffer = rest;
    for (const frame of events) handle(frame);
  };

  xhr.open("POST", url);
  for (const [key, value] of Object.entries(api.headers({ Accept: "text/event-stream" }))) {
    xhr.setRequestHeader(key, value);
  }

  xhr.onprogress = pump;

  xhr.onload = () => {
    pump();
    if (cancelled) return;

    // A non-2xx never streamed at all — it is an ordinary error envelope.
    if (xhr.status < 200 || xhr.status >= 300) {
      handlers.onError?.(
        xhr.status === 402
          ? "Discern requires an active subscription."
          : `Abigail is unavailable right now (${xhr.status}).`,
      );
      return;
    }

    // A stream that ends without `done` is a dropped connection, not a finished
    // turn. Saying so beats leaving a spinner up forever.
    if (!sawDone) handlers.onError?.("The connection dropped before she finished.");
  };

  xhr.onerror = () => {
    if (!cancelled) handlers.onError?.("Could not reach Discern. Check your connection.");
  };

  xhr.ontimeout = () => {
    if (!cancelled) handlers.onError?.("That took too long. Try again.");
  };

  xhr.send(JSON.stringify({ content, ...(options.speakReply === undefined ? {} : { speakReply: options.speakReply }) }));

  return {
    cancel(): void {
      cancelled = true;
      xhr.abort();
    },
  };
}
