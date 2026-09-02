# Atlas Vector Search indexes

These JSON files are the **source of truth** for Discern's vector indexes. They are
committed rather than created by hand in the Atlas UI, because an index definition
that exists only in a dashboard is a piece of production configuration nobody can
review, diff, or recreate.

| File | Collection | Index name |
|---|---|---|
| `passages.json` | `passages` | `passages_vector` |
| `hymns.json` | `hymns` | `hymns_vector` |

## These are NOT Mongoose indexes

`db/connect.ts:syncIndexes()` builds every index declared on a schema at boot.
It does **not** build these. Atlas Search indexes live in a separate subsystem
with its own API, and `createIndexes()` neither creates nor validates them.

They also **cannot be created on a local `mongod`**. `$vectorSearch` is an Atlas
feature: against a local server it fails with

```
MongoServerError: $vectorSearch stage is only allowed on MongoDB Atlas
```

That is expected, not a misconfiguration. See "Local development" below.

## `numDimensions` must match the embedding model

`numDimensions` in both files is **3072**, which is the output width of
`text-embedding-3-large` — the default in `config/models.ts`.

**Atlas does not validate a vector's length against the index on write.** A
mismatch does not error. It surfaces as a query that returns nothing, or returns
results scored in a space that does not match the data — both of which read as
"retrieval is bad" rather than "the index is wrong", which is a long way from the
symptom to the cause.

So if `EMBEDDING_MODEL` is ever overridden:

1. Add the model's width to `EMBEDDING_DIMENSIONS` in `config/models.ts`.
2. Update `numDimensions` in **both** files here.
3. Re-apply the indexes (below).
4. Re-run `npm run embed` — the backfill selects on `embeddingModel`, so a model
   change makes every existing document eligible automatically.

Skipping step 4 leaves vectors from two different models in one index, which is
silent and produces nonsense rankings.

## Applying them

### Atlas CLI (preferred — it is scriptable and reviewable)

```bash
atlas deployments search indexes create --file src/db/search-indexes/passages.json --projectId <PROJECT_ID> --clusterName <CLUSTER>
```

```bash
atlas deployments search indexes create --file src/db/search-indexes/hymns.json --projectId <PROJECT_ID> --clusterName <CLUSTER>
```

### Atlas UI

Atlas → Cluster → **Atlas Search** → *Create Search Index* → **JSON Editor** →
select **Vector Search**, choose the `discern` database and the collection, then
paste the `definition` object from the file. The index **name** must match the
`name` field exactly — retrieval looks it up by that name.

### Verifying

```bash
atlas deployments search indexes list --projectId <PROJECT_ID> --clusterName <CLUSTER>
```

An index reports `status: PENDING` while it builds. On a corpus of ~4,100
passages this is quick, but queries return nothing until it reaches `READY` —
worth checking before concluding that retrieval is broken.

## Filter fields

The `filter` entries are what let `searchScripture` narrow by `stageSlug`,
`situation`, `authorId` or `bookSlug` **inside** the vector search rather than
after it. This distinction is not cosmetic: filtering after the fact means asking
for 10 results, discarding the ones that do not match, and being left with three.
Filtering inside means the engine searches only the matching subset and still
returns 10.

A field must be declared here to be filterable. Adding a new filter to
`searchScripture` requires adding it to these files and re-applying the index.

## Local development

`$vectorSearch` is unavailable outside Atlas, so `services/corpus/retrieval.ts`
falls back to **exact cosine similarity computed in the application** when the
Atlas stage is not available.

The fallback is correct — exact KNN is, if anything, more accurate than the
approximate search Atlas performs — but it loads every embedding into memory and
scores them one by one. At ~4,100 passages × 3072 dimensions that is roughly
100 MB and a noticeable pause per query. It exists so retrieval quality can be
judged during development; **it is not a production path**, and it logs a warning
every time it is used so it can never be mistaken for one.

The keyword half of hybrid retrieval uses a normal Mongo text index
(`passage_text`, `hymn_text`), which is declared on the schema and therefore
built by `syncIndexes()` on both local and Atlas deployments.

## When the index is missing

The worker **warns and continues** rather than crashing (Corner's precedent, and
the same reasoning): the Bible reader, author navigation, journey and carryings
all work without a vector index. Only retrieval — and therefore Abigail — does
not. Refusing to boot the whole service over it would take down the free half of
the product to protect the paid half.
