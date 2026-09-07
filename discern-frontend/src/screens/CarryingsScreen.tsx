// Carryings — active, released, and the audio path proved end to end.
//
// The three-carrying cap is the thesis, not a technical limit: you cannot dwell
// on ten things, and an unbounded list turns carryings into a reading queue. So
// `atCap` is rendered as a fact about the product rather than as an error.
//
// Released carryings are kept FOREVER and paged: `released` is a bounded page
// and `releasedTotal` is the truth, which is why the placeholder prints both —
// a screen that shows only the page will quietly under-report as the years go.

import React, { useCallback, useEffect, useState } from "react";
import { Button, Text, View } from "react-native";

import type { CarryingsListResponse } from "@discern/shared";

import { api } from "../services/api";
import { extractApiError } from "../services/apiError";
import { playCarryingPassage } from "../services/audio";
import { Heading, Raw, Screen } from "./Raw";

export function CarryingsScreen(): React.JSX.Element {
  const [list, setList] = useState<CarryingsListResponse | null>(null);
  const [playback, setPlayback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setList(await api.carryings(20));
    } catch (cause) {
      setError(extractApiError(cause).message);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Prove the audio path: signed url -> player -> sound.
   *
   * The player is removed as soon as it finishes so the audio session does not
   * stay open — a scaffold that leaks one holds the route against whatever
   * plays next, which reads as "audio is broken" on a later screen.
   */
  const play = useCallback(async (id: string): Promise<void> => {
    setPlayback("fetching signed url…");
    try {
      const result = await playCarryingPassage(id);
      if (result.refusedReason) {
        // A refusal is information, not a failure. Say it.
        setPlayback(`refused: ${result.refusedReason}`);
        return;
      }
      setPlayback(
        `playing ${result.reference} (${result.translation}) — cached=${result.cached}`,
      );
      console.log("[audio] playing", result.reference, "cached =", result.cached);
    } catch (cause) {
      setPlayback(null);
      setError(extractApiError(cause).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen title="Carryings" loading={loading} error={error}>
      <Button title="Reload" onPress={() => void load()} />
      {playback ? <Text>{playback}</Text> : null}

      {list ? (
        <View>
          <Text>
            {`${list.active.length} of ${list.activeCap} carried` +
              (list.atCap ? " — at the cap; put something down first" : "")}
          </Text>
          <Text>{`${list.releasedTotal} released in total (${list.released.length} on this page)`}</Text>

          <Heading>Active</Heading>
          {list.active.length === 0 ? <Text>Nothing carried yet.</Text> : null}
          {list.active.map((carrying) => (
            <View key={carrying.id}>
              <Text>{`${carrying.reference ?? carrying.refId} — from ${carrying.source}`}</Text>
              <Text>{`why: ${carrying.why ?? "(self-added)"}`}</Text>
              <Text>
                {`${carrying.revisitCount} revisits · ${carrying.totalDwellSeconds}s dwelt · ${carrying.notes.length} notes`}
              </Text>
              <Button title="Play the passage" onPress={() => void play(carrying.id)} />
            </View>
          ))}

          <Heading>Released</Heading>
          {list.released.length === 0 ? <Text>Nothing released yet.</Text> : null}
          {list.released.map((carrying) => (
            <Text key={carrying.id}>
              {`${carrying.reference ?? carrying.refId} — released ${carrying.releasedAt}`}
            </Text>
          ))}
        </View>
      ) : null}

      <Heading>Raw</Heading>
      <Raw value={list} />
    </Screen>
  );
}
