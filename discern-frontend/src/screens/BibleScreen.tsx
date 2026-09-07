// Bible — the books index, and one chapter opened from it.
//
// GET /v1/bible/books serves BOTH navigations the app will offer: canonical
// book order, and author-first, because every row carries its author link.
// `author: null` is a fact about the text, not missing data — several books
// have no settled author — so the placeholder prints "unknown" rather than
// hiding the row.

import React, { useCallback, useEffect, useState } from "react";
import { Button, Text, View } from "react-native";

import type { BookSummary, ChapterResponse } from "@discern/shared";

import { api } from "../services/api";
import { extractApiError } from "../services/apiError";
import { Heading, Raw, Screen } from "./Raw";

export function BibleScreen(): React.JSX.Element {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [chapter, setChapter] = useState<ChapterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setBooks((await api.books()).books);
    } catch (cause) {
      setError(extractApiError(cause).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const open = useCallback(async (slug: string): Promise<void> => {
    setError(null);
    try {
      setChapter(await api.chapter(slug, 1));
    } catch (cause) {
      setError(extractApiError(cause).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen title="Bible — books index" loading={loading} error={error}>
      <Text>{`${books.length} books`}</Text>

      {chapter ? (
        <View>
          <Heading>{`${chapter.book.name} ${chapter.chapter} (${chapter.translation.abbreviation})`}</Heading>
          <Text>{`author: ${chapter.author?.name ?? "unknown"}`}</Text>
          <Text>{`${chapter.verses.length} verses`}</Text>
          <Raw
            value={chapter.verses
              .slice(0, 4)
              .map((v) => `${v.chapter}:${v.verse} ${v.text}`)
              .join("\n")}
          />
        </View>
      ) : null}

      <Heading>Tap a book to open chapter 1</Heading>
      {books.map((book) => (
        <View key={book.slug}>
          <Button
            title={`${book.name} · ${book.chapterCount}ch · ${book.author?.name ?? "author unknown"}`}
            onPress={() => void open(book.slug)}
          />
        </View>
      ))}
    </Screen>
  );
}
