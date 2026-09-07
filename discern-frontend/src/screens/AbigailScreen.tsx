// Abigail — the streaming client, proved.
//
// Console-logged for now, as the brief says; the UI comes later. But the three
// event kinds are handled properly rather than logged and forgotten, because
// two of them are not cosmetic:
//
//   progress   the ONLY thing on screen for the first 30-60 seconds. Rounds 1-3
//              produce no reply text at all — she is searching, reading and
//              choosing — and a client that renders nothing until the first
//              token is a client that looks broken for most of a turn.
//   restart    THE REPLY SO FAR IS VOID. Grounding failed or the two-passage
//              cap fired, and she is starting again. The buffer is cleared
//              here. Appending through a restart would render half a discarded
//              reply joined to half a real one.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Text, TextInput, View } from "react-native";

import type { TurnProgress } from "@discern/shared";

import { api } from "../services/api";
import { extractApiError, isRateLimited } from "../services/apiError";
import { streamTurn } from "../services/stream";
import type { StreamHandle } from "../services/stream";
import { Heading, Screen } from "./Raw";

/** One line of the activity trail. Deliberately literal about what happened. */
function describe(event: TurnProgress): string {
  switch (event.type) {
    case "premise":
      return "reading the premise underneath what you said";
    case "searching":
      return `searching: ${event.query}`;
    case "found":
      return `found: ${event.references.join(", ")}`;
    case "reading":
      return `reading ${event.reference}`;
    case "author":
      return `looking up ${event.name}`;
    case "choosing":
      return `choosing ${event.reference}`;
    case "writing":
      return "writing";
    case "restart":
      return `STARTING OVER (${event.reason}) — everything above is discarded`;
    case "audio":
      return `audio ready for sentence ${event.index}`;
    case "audio-unavailable":
      return `no audio: ${event.reason}`;
  }
}

export function AbigailScreen(): React.JSX.Element {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [trail, setTrail] = useState<string[]>([]);
  const [reply, setReply] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<StreamHandle | null>(null);

  const start = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const conversation = await api.startConversation("text");
      setConversationId(conversation.id);
      setTrail([`conversation ${conversation.id} started`]);
      console.log("[abigail] conversation", conversation.id);
    } catch (cause) {
      setError(
        isRateLimited(cause)
          ? "Rate limited — 30 turns an hour. Try again shortly."
          : extractApiError(cause).message,
      );
    }
  }, []);

  const send = useCallback((): void => {
    if (!conversationId || !content.trim()) return;

    setRunning(true);
    setReply("");
    setError(null);
    setTrail((lines) => [...lines, `> ${content}`]);

    handle.current = streamTurn(conversationId, content, {
      onProgress: (event) => {
        console.log("[abigail] progress", event);
        setTrail((lines) => [...lines, describe(event)]);
      },
      onToken: (text) => {
        setReply((current) => current + text);
      },
      onRestart: (reason) => {
        // NOT cosmetic. What was rendered is not what she said.
        console.warn("[abigail] restart —", reason, "— discarding the reply so far");
        setReply("");
      },
      onDone: (result) => {
        console.log(
          `[abigail] done in ${result.latencyMs}ms via ${result.modelUsed}, ` +
            `citations: ${result.citations.join(", ") || "none"}`,
        );
        setReply(result.reply);
        setTrail((lines) => [
          ...lines,
          `done in ${Math.round(result.latencyMs / 1000)}s via ${result.modelUsed}` +
            (result.citations.length > 0 ? ` — ${result.citations.join(", ")}` : ""),
        ]);
        setRunning(false);
      },
      onError: (message) => {
        console.warn("[abigail] stream error", message);
        setError(message);
        setRunning(false);
      },
    });

    setContent("");
  }, [conversationId, content]);

  // A screen that goes away mid-turn must not leave the request running.
  useEffect(() => () => handle.current?.cancel(), []);

  return (
    <Screen title="Abigail" error={error}>
      {conversationId === null ? (
        <Button title="Start a conversation" onPress={() => void start()} />
      ) : (
        <View>
          <TextInput
            value={content}
            onChangeText={setContent}
            placeholder="Say something to her"
            editable={!running}
            multiline
            style={{ borderWidth: 1, minHeight: 60, padding: 8, marginVertical: 8 }}
          />
          <Button
            title={running ? "…" : "Send"}
            onPress={send}
            disabled={running || content.trim().length === 0}
          />
          {running ? <Button title="Cancel" onPress={() => handle.current?.cancel()} /> : null}
        </View>
      )}

      <Heading>Activity</Heading>
      {trail.map((line, index) => (
        <Text key={`${index}-${line}`}>{line}</Text>
      ))}

      <Heading>Reply</Heading>
      <Text>{reply || "(nothing yet)"}</Text>
    </Screen>
  );
}
