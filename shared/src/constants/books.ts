// The canonical 66-book Protestant table.
//
// Lives in shared because it is a contract, not a backend detail: the app builds
// its reader navigation from the same slugs and names the API returns, and a
// disagreement about whether it is "song-of-solomon" or "song-of-songs" is a
// broken link rather than a type error.
//
// `usfmId` is the three-character book code used by USFM/USX files from
// ebible.org (ARCHITECTURE.md §5) and is how the ingestion script maps a source
// file to a book. `aliases` feed reference parsing — "Eph 2:8-10" and
// "Ephesians 2:8-10" must resolve to the same passage.

export type Testament = "old" | "new";

export interface BookMeta {
  /** USFM/USX book identifier, e.g. "EPH". */
  usfmId: string;
  slug: string;
  name: string;
  testament: Testament;
  /** 1-66, canonical Protestant order. */
  canonicalOrder: number;
  chapterCount: number;
  /**
   * Lowercase forms accepted by reference parsing, beyond the slug and the name.
   * Matching is done after stripping spaces and periods, so "1 Cor." and "1cor"
   * both reduce to "1cor" and only that form needs listing.
   */
  aliases: string[];
  /**
   * How the name is SAID, when that differs from how it is written.
   *
   * Only set where the written form would be read wrongly. "Psalms 27:1" is
   * spoken "Psalm twenty-seven" — singular, because you are naming one psalm
   * out of the book — and everything else derives from `name` plus
   * `chapterCount`, so this stays almost empty by design.
   *
   * THE SINGLE PLACE A PRONUNCIATION IS FIXED. There are no reference strings
   * in the speech code; it reads this table and the structure of the parsed
   * reference. A new book or an awkward name is a data change here.
   */
  spokenName?: string;
  /**
   * The word before a chapter number when spoken, or null for none.
   *
   * Defaults to "chapter". Psalms sets it to null because the number IS the
   * psalm — "Psalm twenty-seven", never "Psalm chapter twenty-seven" — and no
   * amount of cleverness in the speech code would derive that from a name and
   * a chapter count. It is a fact about the book, so it lives with the book.
   */
  spokenChapterWord?: string | null;
}

export const BOOKS: readonly BookMeta[] = [
  // ---- Old Testament ------------------------------------------------------
  { usfmId: "GEN", slug: "genesis", name: "Genesis", testament: "old", canonicalOrder: 1, chapterCount: 50, aliases: ["gen", "ge", "gn"] },
  { usfmId: "EXO", slug: "exodus", name: "Exodus", testament: "old", canonicalOrder: 2, chapterCount: 40, aliases: ["exo", "ex", "exod"] },
  { usfmId: "LEV", slug: "leviticus", name: "Leviticus", testament: "old", canonicalOrder: 3, chapterCount: 27, aliases: ["lev", "lv"] },
  { usfmId: "NUM", slug: "numbers", name: "Numbers", testament: "old", canonicalOrder: 4, chapterCount: 36, aliases: ["num", "nu", "nm"] },
  { usfmId: "DEU", slug: "deuteronomy", name: "Deuteronomy", testament: "old", canonicalOrder: 5, chapterCount: 34, aliases: ["deu", "dt", "deut"] },
  { usfmId: "JOS", slug: "joshua", name: "Joshua", testament: "old", canonicalOrder: 6, chapterCount: 24, aliases: ["jos", "josh"] },
  { usfmId: "JDG", slug: "judges", name: "Judges", testament: "old", canonicalOrder: 7, chapterCount: 21, aliases: ["jdg", "judg", "jg"] },
  { usfmId: "RUT", slug: "ruth", name: "Ruth", testament: "old", canonicalOrder: 8, chapterCount: 4, aliases: ["rut", "rth"] },
  { usfmId: "1SA", slug: "1-samuel", name: "1 Samuel", testament: "old", canonicalOrder: 9, chapterCount: 31, aliases: ["1sa", "1sam", "isam", "1s"] },
  { usfmId: "2SA", slug: "2-samuel", name: "2 Samuel", testament: "old", canonicalOrder: 10, chapterCount: 24, aliases: ["2sa", "2sam", "iisam", "2s"] },
  { usfmId: "1KI", slug: "1-kings", name: "1 Kings", testament: "old", canonicalOrder: 11, chapterCount: 22, aliases: ["1ki", "1kgs", "1kg", "ikings"] },
  { usfmId: "2KI", slug: "2-kings", name: "2 Kings", testament: "old", canonicalOrder: 12, chapterCount: 25, aliases: ["2ki", "2kgs", "2kg", "iikings"] },
  { usfmId: "1CH", slug: "1-chronicles", name: "1 Chronicles", testament: "old", canonicalOrder: 13, chapterCount: 29, aliases: ["1ch", "1chr", "1chron"] },
  { usfmId: "2CH", slug: "2-chronicles", name: "2 Chronicles", testament: "old", canonicalOrder: 14, chapterCount: 36, aliases: ["2ch", "2chr", "2chron"] },
  { usfmId: "EZR", slug: "ezra", name: "Ezra", testament: "old", canonicalOrder: 15, chapterCount: 10, aliases: ["ezr"] },
  { usfmId: "NEH", slug: "nehemiah", name: "Nehemiah", testament: "old", canonicalOrder: 16, chapterCount: 13, aliases: ["neh", "ne"] },
  { usfmId: "EST", slug: "esther", name: "Esther", testament: "old", canonicalOrder: 17, chapterCount: 10, aliases: ["est", "esth"] },
  { usfmId: "JOB", slug: "job", name: "Job", testament: "old", canonicalOrder: 18, chapterCount: 42, aliases: ["jb"] },
  { usfmId: "PSA", slug: "psalms", name: "Psalms", testament: "old", canonicalOrder: 19, chapterCount: 150, aliases: ["psa", "ps", "psalm", "pss"], spokenName: "Psalm", spokenChapterWord: null },
  { usfmId: "PRO", slug: "proverbs", name: "Proverbs", testament: "old", canonicalOrder: 20, chapterCount: 31, aliases: ["pro", "prov", "pr"] },
  { usfmId: "ECC", slug: "ecclesiastes", name: "Ecclesiastes", testament: "old", canonicalOrder: 21, chapterCount: 12, aliases: ["ecc", "eccl", "ec", "qoh"] },
  { usfmId: "SNG", slug: "song-of-solomon", name: "Song of Solomon", testament: "old", canonicalOrder: 22, chapterCount: 8, aliases: ["sng", "song", "songofsongs", "sos", "canticles"] },
  { usfmId: "ISA", slug: "isaiah", name: "Isaiah", testament: "old", canonicalOrder: 23, chapterCount: 66, aliases: ["isa", "is"] },
  { usfmId: "JER", slug: "jeremiah", name: "Jeremiah", testament: "old", canonicalOrder: 24, chapterCount: 52, aliases: ["jer", "je"] },
  { usfmId: "LAM", slug: "lamentations", name: "Lamentations", testament: "old", canonicalOrder: 25, chapterCount: 5, aliases: ["lam", "la"] },
  { usfmId: "EZK", slug: "ezekiel", name: "Ezekiel", testament: "old", canonicalOrder: 26, chapterCount: 48, aliases: ["ezk", "eze", "ezek"] },
  { usfmId: "DAN", slug: "daniel", name: "Daniel", testament: "old", canonicalOrder: 27, chapterCount: 12, aliases: ["dan", "dn"] },
  { usfmId: "HOS", slug: "hosea", name: "Hosea", testament: "old", canonicalOrder: 28, chapterCount: 14, aliases: ["hos", "ho"] },
  { usfmId: "JOL", slug: "joel", name: "Joel", testament: "old", canonicalOrder: 29, chapterCount: 3, aliases: ["jol", "joe", "jl"] },
  { usfmId: "AMO", slug: "amos", name: "Amos", testament: "old", canonicalOrder: 30, chapterCount: 9, aliases: ["amo", "am"] },
  { usfmId: "OBA", slug: "obadiah", name: "Obadiah", testament: "old", canonicalOrder: 31, chapterCount: 1, aliases: ["oba", "ob", "obad"] },
  { usfmId: "JON", slug: "jonah", name: "Jonah", testament: "old", canonicalOrder: 32, chapterCount: 4, aliases: ["jon", "jnh"] },
  { usfmId: "MIC", slug: "micah", name: "Micah", testament: "old", canonicalOrder: 33, chapterCount: 7, aliases: ["mic", "mi"] },
  { usfmId: "NAM", slug: "nahum", name: "Nahum", testament: "old", canonicalOrder: 34, chapterCount: 3, aliases: ["nam", "nah", "na"] },
  { usfmId: "HAB", slug: "habakkuk", name: "Habakkuk", testament: "old", canonicalOrder: 35, chapterCount: 3, aliases: ["hab", "hb"] },
  { usfmId: "ZEP", slug: "zephaniah", name: "Zephaniah", testament: "old", canonicalOrder: 36, chapterCount: 3, aliases: ["zep", "zeph", "zph"] },
  { usfmId: "HAG", slug: "haggai", name: "Haggai", testament: "old", canonicalOrder: 37, chapterCount: 2, aliases: ["hag", "hg"] },
  { usfmId: "ZEC", slug: "zechariah", name: "Zechariah", testament: "old", canonicalOrder: 38, chapterCount: 14, aliases: ["zec", "zech", "zc"] },
  { usfmId: "MAL", slug: "malachi", name: "Malachi", testament: "old", canonicalOrder: 39, chapterCount: 4, aliases: ["mal", "ml"] },

  // ---- New Testament ------------------------------------------------------
  { usfmId: "MAT", slug: "matthew", name: "Matthew", testament: "new", canonicalOrder: 40, chapterCount: 28, aliases: ["mat", "mt", "matt"] },
  { usfmId: "MRK", slug: "mark", name: "Mark", testament: "new", canonicalOrder: 41, chapterCount: 16, aliases: ["mrk", "mk", "mar"] },
  { usfmId: "LUK", slug: "luke", name: "Luke", testament: "new", canonicalOrder: 42, chapterCount: 24, aliases: ["luk", "lk"] },
  { usfmId: "JHN", slug: "john", name: "John", testament: "new", canonicalOrder: 43, chapterCount: 21, aliases: ["jhn", "jn", "joh"] },
  { usfmId: "ACT", slug: "acts", name: "Acts", testament: "new", canonicalOrder: 44, chapterCount: 28, aliases: ["act", "ac"] },
  { usfmId: "ROM", slug: "romans", name: "Romans", testament: "new", canonicalOrder: 45, chapterCount: 16, aliases: ["rom", "ro", "rm"] },
  { usfmId: "1CO", slug: "1-corinthians", name: "1 Corinthians", testament: "new", canonicalOrder: 46, chapterCount: 16, aliases: ["1co", "1cor", "icor"] },
  { usfmId: "2CO", slug: "2-corinthians", name: "2 Corinthians", testament: "new", canonicalOrder: 47, chapterCount: 13, aliases: ["2co", "2cor", "iicor"] },
  { usfmId: "GAL", slug: "galatians", name: "Galatians", testament: "new", canonicalOrder: 48, chapterCount: 6, aliases: ["gal", "ga"] },
  { usfmId: "EPH", slug: "ephesians", name: "Ephesians", testament: "new", canonicalOrder: 49, chapterCount: 6, aliases: ["eph", "ep"] },
  { usfmId: "PHP", slug: "philippians", name: "Philippians", testament: "new", canonicalOrder: 50, chapterCount: 4, aliases: ["php", "phil", "pp"] },
  { usfmId: "COL", slug: "colossians", name: "Colossians", testament: "new", canonicalOrder: 51, chapterCount: 4, aliases: ["col", "cl"] },
  { usfmId: "1TH", slug: "1-thessalonians", name: "1 Thessalonians", testament: "new", canonicalOrder: 52, chapterCount: 5, aliases: ["1th", "1thess", "1thes", "ithess"] },
  { usfmId: "2TH", slug: "2-thessalonians", name: "2 Thessalonians", testament: "new", canonicalOrder: 53, chapterCount: 3, aliases: ["2th", "2thess", "2thes", "iithess"] },
  { usfmId: "1TI", slug: "1-timothy", name: "1 Timothy", testament: "new", canonicalOrder: 54, chapterCount: 6, aliases: ["1ti", "1tim", "itim"] },
  { usfmId: "2TI", slug: "2-timothy", name: "2 Timothy", testament: "new", canonicalOrder: 55, chapterCount: 4, aliases: ["2ti", "2tim", "iitim"] },
  { usfmId: "TIT", slug: "titus", name: "Titus", testament: "new", canonicalOrder: 56, chapterCount: 3, aliases: ["tit", "ti"] },
  { usfmId: "PHM", slug: "philemon", name: "Philemon", testament: "new", canonicalOrder: 57, chapterCount: 1, aliases: ["phm", "phlm", "philem"] },
  { usfmId: "HEB", slug: "hebrews", name: "Hebrews", testament: "new", canonicalOrder: 58, chapterCount: 13, aliases: ["heb", "hb"] },
  { usfmId: "JAS", slug: "james", name: "James", testament: "new", canonicalOrder: 59, chapterCount: 5, aliases: ["jas", "jam", "jm"] },
  { usfmId: "1PE", slug: "1-peter", name: "1 Peter", testament: "new", canonicalOrder: 60, chapterCount: 5, aliases: ["1pe", "1pet", "ipet"] },
  { usfmId: "2PE", slug: "2-peter", name: "2 Peter", testament: "new", canonicalOrder: 61, chapterCount: 3, aliases: ["2pe", "2pet", "iipet"] },
  { usfmId: "1JN", slug: "1-john", name: "1 John", testament: "new", canonicalOrder: 62, chapterCount: 5, aliases: ["1jn", "1jo", "1john", "ijohn"] },
  { usfmId: "2JN", slug: "2-john", name: "2 John", testament: "new", canonicalOrder: 63, chapterCount: 1, aliases: ["2jn", "2jo", "2john", "iijohn"] },
  { usfmId: "3JN", slug: "3-john", name: "3 John", testament: "new", canonicalOrder: 64, chapterCount: 1, aliases: ["3jn", "3jo", "3john", "iiijohn"] },
  { usfmId: "JUD", slug: "jude", name: "Jude", testament: "new", canonicalOrder: 65, chapterCount: 1, aliases: ["jud", "jde"] },
  { usfmId: "REV", slug: "revelation", name: "Revelation", testament: "new", canonicalOrder: 66, chapterCount: 22, aliases: ["rev", "rv", "apocalypse"] },
] as const;

export const BOOK_SLUGS = BOOKS.map((book) => book.slug);

const BY_SLUG = new Map(BOOKS.map((book) => [book.slug, book]));
const BY_USFM_ID = new Map(BOOKS.map((book) => [book.usfmId, book]));

export function bookBySlug(slug: string): BookMeta | undefined {
  return BY_SLUG.get(slug);
}

export function bookByUsfmId(usfmId: string): BookMeta | undefined {
  return BY_USFM_ID.get(usfmId.toUpperCase());
}

/**
 * Normalised lookup key: lowercase, no spaces, no periods.
 *
 * "1 Cor.", "1Cor", "i cor" and "1cor" all reduce to the same thing, which is
 * why the alias lists above only carry one form of each.
 */
export function normalizeBookKey(input: string): string {
  return input.toLowerCase().replace(/[\s.]/g, "");
}

const BY_NORMALIZED = new Map<string, BookMeta>();
for (const book of BOOKS) {
  BY_NORMALIZED.set(normalizeBookKey(book.name), book);
  BY_NORMALIZED.set(normalizeBookKey(book.slug), book);
  // The slug's hyphens survive normalisation ("1-john"), so index the
  // hyphen-free form too, which is what "1John" reduces to.
  BY_NORMALIZED.set(normalizeBookKey(book.slug.replace(/-/g, "")), book);
  for (const alias of book.aliases) {
    BY_NORMALIZED.set(normalizeBookKey(alias), book);
  }
}

/** Resolves any accepted spelling of a book name. */
export function bookByAnyName(input: string): BookMeta | undefined {
  return BY_NORMALIZED.get(normalizeBookKey(input));
}
