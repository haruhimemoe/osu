<p align="center"><a href="https://github.com/haruhimemoe/osu"><picture><source media="(prefers-color-scheme: light)" srcset="https://www.haruhime.moe/brand/repos/osu-banner-on-light.svg"><img alt="@haruhimemoe/osu" src="https://www.haruhime.moe/brand/repos/osu-banner.svg" width="640"></picture></a></p>

# @haruhimemoe/osu

osu! API v2 for the haruhime.moe tools: [packs](https://packs.haruhime.moe), [pools](https://pools.haruhime.moe) (in beta) and, soon, sheets. It comes in three parts:

- **`@haruhimemoe/osu/shapes`**: the data. Zod schemas and types for a difficulty (`BeatmapMeta` and osu!'s beatmap row), a beatmapset's content fields, and the signed-in user, plus osu! links and the sign-in endpoints. No client code, so it's safe in browsers and in other packages that read osu!-shaped data, like mirrors.
- **`@haruhimemoe/osu/collections`**: reads and writes osu!stable's `collection.db`, so a web page can add maps to a player's collections: stable takes the edited file back, and lazer imports it through its setup wizard. Safe in browsers, and it doesn't load zod.
- **`@haruhimemoe/osu`**: everything above, plus `createOsuClient` for servers. It caches the client-credentials token, sends your User-Agent, and has a hook for a shared rate budget. It fetches beatmaps, beatmapsets and star ratings with mods.

## Install

```sh
npm install @haruhimemoe/osu zod
# or
bun add @haruhimemoe/osu zod
```

`zod` (4.0.16 or later in 4.x) is a peer dependency. The package is ESM only.

## The client

```ts
// osu.ts
import { createOsuClient } from "@haruhimemoe/osu";

// One client per process: the token is cached on it.
export const osu = createOsuClient({
  userAgent: "my-tool (+https://example.com; me@example.com)",
  credentials: () => ({
    clientId: process.env.OSU_CLIENT_ID ?? "",
    clientSecret: process.env.OSU_CLIENT_SECRET ?? "",
  }),
});
```

```ts
import { osu } from "./osu.js";

const { found, missing, unchecked } = await osu.getBeatmaps([129891, 75]);
console.log(found.get(75)?.title, missing, unchecked);

const stars = await osu.getStarRating(129891, ["HD", "HR"]); // a number, or null

const { sets } = await osu.getBeatmapsets([129891]);
console.log(sets.get(129891)?.availability.download_disabled);
```

Keep the client on the server. It holds your client secret. Browsers use `/shapes` and ask your server.

The client uses the client credentials grant with scope `public`. It asks for a token on the first call, shares that request between concurrent calls, and reuses the token until a minute before it expires. A 401 drops the token and retries the call once with a fresh one.

### Options

`createOsuClient(options)` takes:

- **`userAgent`** (required): names your app and how to reach you. It goes on every request, the token request included. An empty value, or one with a line break or other control character, throws a `TypeError`.
- **`credentials`** (required): `{ clientId, clientSecret }`, or a function that returns it. Both fields must be strings that aren't blank, else you get a `TypeError` that names the field but not its value. An object is checked when you create the client. A function is called on every token request (the first call, each refresh, and after a 401), never at import, so importing the module never needs env and a rotated secret is picked up. If it throws, its error reaches you unchanged.
- **`baseUrl`** (default `https://osu.ppy.sh`): token requests go here too, so this server receives your client secret. Point it only at osu! itself or your own test server, never at a mirror. It must be an absolute `https` URL, or `http` on `localhost` / `127.0.0.1`, else `createOsuClient` throws a `RangeError`. Trailing slashes are dropped.
- **`timeoutMs`** (default `10000`): each request, answer and body, gives up after this long, so a hung osu! call can't hold a serverless function. It must be an integer from 1 to 2147483647, else `RangeError`.
- **`fetch`** and **`now`**: for tests. `fetch` replaces `globalThis.fetch`. `now` replaces `Date.now` as the clock for token expiry and for turning a `Retry-After` date into `retryAfterMs`.

### Methods

**`getBeatmaps(ids, { beforeCall })`** asks `/api/v2/beatmaps` 50 ids at a time, after dropping duplicates, and returns `{ found, missing, unchecked }`:

- `found`: `BeatmapMeta` by difficulty id.
- `missing`: ids that aren't positive safe integers (never sent), and ids osu! answered no row for (unless that batch had a row without a readable `id`, below).
- `unchecked`: ids in a batch `beforeCall` refused; ids whose row osu! sent but that fails our schema; and, when a row in a batch has no readable `id`, every id in that batch without a good row (we can't tell which one it was).
- It throws an `OsuApiError` when the token request fails, or a `/beatmaps` call answers an error status (after the one 401 retry), sends a body that isn't `{ beatmaps: [...] }`, times out, or can't reach osu!. The whole call throws, and batches already fetched are lost.

**`getBeatmapsets(ids, { beforeCall, fallbackLimit })`** returns `{ sets, unchecked }`. `sets` is keyed by beatmap (difficulty) id, not set id, and sibling difficulties share one set object. Each set holds the content fields in `OsuBeatmapsetExtended`, not osu!'s whole object. It asks `/api/v2/beatmaps` 50 ids at a time. When a row's set comes compact, it asks `/api/v2/beatmapsets/{id}` for that set, at most `fallbackLimit` times per call (10 by default; 0 makes no fallback calls).

- `unchecked`: ids in a `/beatmaps` batch `beforeCall` refused; ids whose row fails our schema (every id of the batch without a good row, when a row has no readable `id`); ids whose set came compact and wasn't looked up because `fallbackLimit` was spent or `beforeCall` refused; and ids whose `/beatmapsets/{id}` lookup failed any way but a 404: an error status, a failed token request, a timeout, a network failure, or a body that isn't a readable, extended set. A failed lookup still counts against `fallbackLimit`, and the call keeps the sets it already has.
- In neither: ids that aren't positive safe integers (never sent), ids osu! answered no row for (same exception as `getBeatmaps`), and ids whose set lookup got a 404 (the set is gone). That includes a 404 from a token request made during the lookup, which happens only when the token expires mid-call or a 401 forces a new one.
- It throws `RangeError` for a `fallbackLimit` that isn't a non-negative integer, before anything is sent. It throws `OsuApiError` when the token request before a `/beatmaps` call fails, or a `/beatmaps` call fails as in `getBeatmaps`. A failed fallback lookup never throws an `OsuApiError`.

**`getStarRating(id, mods, { beforeCall })`** asks `POST /api/v2/beatmaps/{id}/attributes` with `mods` as acronyms (`["HD", "HR"]`) and returns osu!'s star rating for the map in its own ruleset. It makes one call (plus the 401 retry). It returns null when osu! answers 404 (no such map) or 422 (mods it won't rate). It rejects with code `"budget"` when `beforeCall` refuses, and throws `RangeError` when `id` isn't a positive safe integer. The no-mod rating already comes with `BeatmapMeta` as `starRating`.

### Errors

Every failure talking to osu! is an `OsuApiError` with:

- `code`: `"timeout"`, `"network"`, `"bad_response"` (not JSON, or not the expected shape), `"http_error"`, or `"budget"` (only `getStarRating`). Branch on the ones you know; later versions may add codes.
- `status`: osu!'s HTTP status, or null when there was none (network failure, timeout before an answer, budget).
- `retryAfterMs`: osu!'s `Retry-After` on a 429 or 503, capped at 60 s, else null.
- `cause`: the underlying error, when there is one.

Other errors are yours. `createOsuClient` throws a `RangeError` for a bad `timeoutMs` or `baseUrl`, `getBeatmapsets` for a bad `fallbackLimit`, and `getStarRating` for an `id` that isn't a positive safe integer. Bad credentials or a bad `userAgent` throw a `TypeError`. Each is thrown before the request it would affect is sent. Nothing else is checked: bad ids given to `getBeatmaps` or `getBeatmapsets` never throw (they're sorted as described above), and `mods` goes to osu! as given. An error thrown by your `credentials` function or `beforeCall` comes through unchanged.

```ts
import { OsuApiError } from "@haruhimemoe/osu";
import { osu } from "./osu.js";

try {
  await osu.getStarRating(129891, ["DT"]);
} catch (error) {
  if (!(error instanceof OsuApiError)) throw error; // a RangeError, TypeError, or your own error
  if (error.code === "http_error" && error.status === 429) {
    console.log(`osu! says wait ${error.retryAfterMs ?? 60_000} ms`);
  }
}
```

### Staying under osu!'s rate limit

osu! asks API users to stay at or under 60 requests a minute, and to cache what they fetch. Budget per OAuth app, not per request handler: if several features or serverless instances share one app, give them one counter. By default there is no budget: `getBeatmaps` with 5,000 ids makes 100 calls back to back. Pass `beforeCall` to all three methods. They ask it before each planned osu! call and skip the call when it returns false: `getBeatmaps` and `getBeatmapsets` put that call's ids in `unchecked`, and `getStarRating` rejects with code `"budget"`. Token requests aren't counted, and neither is the one retry after a 401. So one approved call can cost two API calls and up to two token requests: one when no token is cached yet, and one for a fresh token after the 401. Leave headroom for that.

```ts
// A fixed-window counter shared by every instance (MongoDB driver 7 here; any atomic store works).
import { MongoClient } from "mongodb";
import { osu } from "./osu.js";

type Counter = { _id: string; count: number; expiresAt: Date };
const db = new MongoClient(process.env.MONGODB_URI ?? "mongodb://localhost:27017").db("my-tool");
const counters = db.collection<Counter>("rate_limits");
// Once, at startup: delete counters after their window.
await counters.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// At most 50 osu! calls a minute, leaving room under osu!'s 60.
const beforeCall = async (): Promise<boolean> => {
  const window = Math.floor(Date.now() / 60_000);
  const counter = await counters.findOneAndUpdate(
    { _id: `osu-api:${window}` },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 2) * 60_000) } },
    { upsert: true, returnDocument: "after" },
  );
  return (counter?.count ?? Number.POSITIVE_INFINITY) <= 50;
};

await osu.getBeatmapsets([129891, 75], { beforeCall });
await osu.getStarRating(129891, ["HD"], { beforeCall });
```

### Client exports

| Export | What it is |
| --- | --- |
| `createOsuClient`, `OsuClient`, `OsuClientOptions`, `OsuCredentials` | The client, its type, its options, and the `{ clientId, clientSecret }` pair. |
| `BeatmapLookup`, `BeatmapOptions` | `getBeatmaps`' result and options. |
| `BeatmapsetLookup`, `BeatmapsetOptions` | `getBeatmapsets`' result and options. |
| `StarRatingOptions` | `getStarRating`'s options. |
| `OsuApiError`, `OsuApiErrorCode` | The error, and its `code` values. `new OsuApiError(code, message, { status, retryAfterMs, cause })` builds one, for tests. |
| `OSU_BEATMAPS_BATCH_LIMIT`, `BEATMAPSET_FALLBACK_LIMIT`, `OSU_TIMEOUT_MS` | 50 ids per `/beatmaps` call, the default `fallbackLimit` (10), the default `timeoutMs` (10,000). |

The root entry point also re-exports everything in `/shapes` and `/collections`.

## Shapes

`@haruhimemoe/osu/shapes` has no I/O and no secrets. Its schemas strip unknown keys. The `osu*Schema` schemas use osu!'s snake_case field names. `beatmapMetaSchema` and the mapped types (`BeatmapMeta`, `OsuUser`) use camelCase.

```ts
import {
  type BeatmapMeta,
  beatmapUrl,
  coverUrl,
  OSU_OAUTH,
  osuBeatmapRowSchema,
  toBeatmapMeta,
  toOsuUser,
} from "@haruhimemoe/osu/shapes";

// A /api/v2/beatmaps row, from osu! or a mirror that copies its shape. A row that doesn't fit throws a ZodError.
export const readRow = (raw: unknown): BeatmapMeta => toBeatmapMeta(osuBeatmapRowSchema.parse(raw));

export const card = (meta: BeatmapMeta) => ({
  name: `${meta.artist} - ${meta.title} [${meta.version}]`,
  link: beatmapUrl(meta.beatmapId),
  cover: coverUrl(meta.beatmapsetId, "list@2x"),
});

// After "sign in with osu!", on your server: who signed in, from the user's access token.
export const signedIn = async (accessToken: string) => {
  const response = await fetch(OSU_OAUTH.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  return toOsuUser(await response.json()); // { osuId, username, avatarUrl, countryCode }
};
```

| Export | What it is |
| --- | --- |
| `BeatmapMeta`, `beatmapMetaSchema` | A difficulty's metadata, whatever source it came from. Fields below. |
| `osuBeatmapRowSchema`, `OsuBeatmapRow`, `toBeatmapMeta` | osu!'s `/api/v2/beatmaps` row (reduced to what `BeatmapMeta` needs), and its mapping to `BeatmapMeta`. Mirrors that copy osu!'s shape parse the same way. |
| `RULESETS`, `Ruleset`, `rulesetSchema` | `"osu"`, `"taiko"`, `"fruits"`, `"mania"`. |
| `osuBeatmapsetSchema`, `OsuBeatmapset` | A beatmapset's content fields, as osu! names them: `id`, `status`, `artist`, `title`, `artist_unicode`, `title_unicode`, `source`, `tags`, the Featured Artist `track_id`, and `availability` (`download_disabled`, `more_information`). A compact set lacks `availability`, `track_id` or `tags`. |
| `OsuBeatmapsetExtended`, `isExtendedBeatmapset` | A set with `availability`, `track_id` and `tags` all present (`track_id` and `tags` may be null), and the type guard that checks it. A compact set needs `/api/v2/beatmapsets/{id}`. Pass an extended set to [`@haruhimemoe/compliance`](https://github.com/haruhimemoe/compliance)'s `factsFromOsuBeatmapset`. |
| `osuBeatmapsetRowSchema` | A `/api/v2/beatmaps` row reduced to `id`, `beatmapset_id` and its `beatmapset`. |
| `osuUserSchema`, `toOsuUser`, `OsuUser` | The signed-in user from `/api/v2/me`. `osuUserSchema` keeps osu!'s names: `id`, `username`, and `avatar_url`, `country_code` and `country.code`, each optional or null. `toOsuUser` takes the raw profile and returns an `OsuUser`, `{ osuId, username, avatarUrl, countryCode }`, reading the country from `country.code`, else `country_code`. It throws a `ZodError` when there's no id or username. osu! never shares an email. |
| `OSU_BASE_URL`, `OSU_OAUTH`, `OSU_SIGN_IN_SCOPES` | `https://osu.ppy.sh`; the sign-in endpoints (`authorizationUrl`, `tokenUrl`, and `userInfoUrl` for `/api/v2/me`); and the scopes `["identify", "public"]`. |
| `coverUrl`, `CoverSize`, `beatmapUrl`, `beatmapsetUrl`, `userUrl` | osu! pages, and cover art on assets.ppy.sh. `coverUrl(setId, size)` takes `"card"` (the default), `"card@2x"`, `"list"`, `"list@2x"`, `"cover"` or `"cover@2x"`. |

`BeatmapMeta` fields, and the osu! row field each comes from:

| Field | Type | From osu!'s row |
| --- | --- | --- |
| `beatmapId`, `beatmapsetId` | positive integer | `id`, `beatmapset_id` |
| `mode` | `Ruleset` | `mode` |
| `title`, `artist`, `creator` | string | `beatmapset.title`, `beatmapset.artist`, `beatmapset.creator` |
| `version` | string | `version` (the difficulty name) |
| `creatorId` | positive integer or null | `beatmapset.user_id` |
| `cs`, `ar`, `od`, `hp` | number | `cs`, `ar`, `accuracy`, `drain` |
| `bpm` | number | `bpm` |
| `lengthSeconds` | integer | `total_length`, rounded |
| `starRating` | number | `difficulty_rating` (no mods) |
| `checksum` | string or null | `checksum`, kept only when it's an md5 (32 lowercase hex characters) |

## Collections

`@haruhimemoe/osu/collections` reads, edits and writes osu!stable's `collection.db`. It takes and returns `Uint8Array`, does no I/O, and imports nothing from the rest of this package (not even zod), so it runs in browsers. Read the file the user picks right in the page: it never has to reach your server.

### What's in collection.db

osu!stable keeps `collection.db` in its install folder, next to `osu!.db`. On Windows that's `%LOCALAPPDATA%\osu!` unless the user installed it somewhere else, so ask for the file rather than guessing a path. The file holds a version number and a list of collections. A collection is a name and a list of difficulty MD5 hashes. That's all: no beatmap ids, no titles.

- The hash is the MD5 of the difficulty's `.osu` file, in lowercase hex. osu!'s API calls it `checksum`, and `BeatmapMeta.checksum` carries it.
- Collections are per difficulty. To add a beatmapset, add the hash of every difficulty in it.
- Hashes for maps the user doesn't have stay in the file. osu! hides them until a matching `.osu` gets imported, then shows them. Adding a map to a collection before downloading it works fine.
- Updating a map changes its hash. The API's `checksum` is always the newest version, so if you hand out the `.osu` files yourself, the MD5 of the bytes you hand out is the surer hash. Adding both does no harm: a hash that matches nothing just stays hidden.

### Read, add, write

```ts
import {
  addToCollection,
  CollectionDbError,
  collectionHashesFor,
  createCollectionDb,
  lazerImportFiles,
  MAX_COLLECTION_DB_BYTES,
  readCollectionDb,
  writeCollectionDb,
} from "@haruhimemoe/osu/collections";
import type { BeatmapMeta } from "@haruhimemoe/osu/shapes";

// osu!stable: edit the whole collection.db the user picked, and hand it back.
export const addToStable = async (file: File, maps: BeatmapMeta[], name: string) => {
  // Check the size first, so a wrong pick (osu!.db, a video) never loads into the tab.
  if (file.size > MAX_COLLECTION_DB_BYTES) {
    throw new CollectionDbError("too_large", "that file is too big to be a collection.db");
  }
  const read = readCollectionDb(new Uint8Array(await file.arrayBuffer()));
  const { hashes, withoutChecksum } = collectionHashesFor(maps);
  const { db, added, alreadyPresent, created, similarName } = addToCollection(read, name, hashes);
  return {
    // Show this before the user saves: "12 added, 3 already there, 2 have no checksum".
    preview: { added, alreadyPresent, created, similarName, noChecksum: withoutChecksum.length },
    file: new Blob([writeCollectionDb(db)]), // save it as collection.db
  };
};

// osu!lazer: only the additions, under the name exactly as the user typed it. Lazer merges them
// into the collection with that name, or creates it.
export const addToLazer = (maps: BeatmapMeta[], name: string) => {
  const { hashes } = collectionHashesFor(maps);
  const delta = { ...createCollectionDb(), collections: [{ name, hashes }] };
  return lazerImportFiles(delta); // collection.db and osu!.import.cfg: zip both at the root
};
```

Check `file.size` before `file.arrayBuffer()`, as above: `readCollectionDb` can only refuse a file after the browser has loaded all of it. Parsing is synchronous, so for a big file call `readCollectionDb` from a Web Worker. Its memory stays bounded either way (see `maxBytes` below).

### Giving it back to osu!stable

`writeCollectionDb` writes the whole file, every collection and hash from the upload included (hashes for maps nobody has, too). Tell the user to:

1. Close osu!. Stable reads `collection.db` once at startup and writes its own copy back later, so a file swapped while it runs gets ignored and then overwritten.
2. Keep a copy of the old `collection.db`.
3. Put the new file in the osu! folder, named exactly `collection.db`. Browsers save a second download as `collection (1).db`.
4. Start osu!.

### Getting collections into osu!lazer

Lazer keeps collections inside its own database, which a browser can't read or write, and it can't export them. The one way in from outside is the setup wizard's import from a previous osu! install. It accepts any folder that looks like a stable install, and it merges the `collection.db` it finds there by exact collection name: new hashes go into the collection with that name, other names become new collections, and nothing gets removed. So the file only needs the additions.

`lazerImportFiles(db)` returns `collection.db` and an empty `osu!.import.cfg`. The empty cfg is what makes the folder pass lazer's check. Zip both at the root of the archive, not inside a folder: extracting a zip already makes a folder named after it. Give the zip a name with no dots apart from `.zip`, because lazer ignores a dropped folder with a dot in its name.

Your page can't see the user's lazer collections, so they have to type the collection's name exactly. Case counts, and a typo creates a new collection. Use the name as typed, the way `addToLazer` does: don't trim it (in lazer, "Farm " and "Farm" are two collections), and don't pass it through `addToCollection`, whose new-name rules would refuse some names lazer takes, such as one over 127 bytes. Refuse an empty name, and if the name starts or ends with a space, point that out before they download. Then they:

1. Extract the zip.
2. In osu!(lazer), open Settings, then General, then "Run setup wizard", and click Next until the Import step.
3. Choose the extracted folder as the previous osu! install, or drag the folder onto the osu! window. If osu!stable is installed, the field already points at it: change it.
4. Untick Beatmaps, Scores and Skins. Check that Collections shows the count they expect, and click Import.
5. Wait for "Imported N collections". Maps they don't have yet count in Manage Collections and show up in song select once they download them.

This works on desktop only. Lazer on Android and iOS can't import collections.

### Functions

**`readCollectionDb(bytes, { maxBytes, lenient })`** returns `{ version, collections, warnings, omittedWarnings }`, with the collections, names and hashes in file order, exactly as found. Anything odd it keeps (or drops) is listed in `warnings` (below): the first 1,000, in file order, with the rest counted in `omittedWarnings`.

- `bytes` must be a `Uint8Array` (a Node `Buffer` is one), else `TypeError`.
- `maxBytes` (default `MAX_COLLECTION_DB_BYTES`, 64 MiB): bigger input throws `too_large` before anything is read. A value that isn't a positive safe integer throws `RangeError`.
- `maxBytes` also caps the collections plus hashes a file can hold at `maxBytes / 34`, rounded down (1,973,790 by default). That's what a file of `maxBytes` holds when every entry is a real hash, which takes 34 bytes. A crafted file can pack an entry into one or two bytes, and each entry costs far more memory than that, so the cap keeps a hostile file's memory near a real file's. A file over it throws `too_large` as soon as its counts pass it, before the entries are read. Real files come nowhere near it, but a file right at `maxBytes` can pass it, so leave some room when you set a small `maxBytes`.
- `lenient` (default `false`): read the way lazer does. An unknown string marker, invalid UTF-8 and bytes after the last collection become warnings instead of errors. Invalid UTF-8 is replaced with U+FFFD, which changes that name's bytes when you write it back, and in lazer a changed name is a different collection.
- Any other problem in the file throws a `CollectionDbError`: a file that ends early, a count that doesn't fit in the bytes left, a bad string length or marker. It never returns part of a file.

**`writeCollectionDb(db, { maxBytes })`** returns the file as a `Uint8Array<ArrayBuffer>`, ready for `new Blob([bytes])`. It writes the database exactly as given: it doesn't lowercase, deduplicate or reorder anything, and it keeps the version (no osu! client reads it). A file stable wrote comes back byte for byte after a read and a write. It throws `invalid_version`, `invalid_name` or `invalid_hash` (a name or hash that isn't a string, or that holds a lone UTF-16 surrogate, which UTF-8 can't encode), then `too_large` when the output would pass `maxBytes` (default 64 MiB). A `db` that isn't shaped like one throws `TypeError`, and a bad `maxBytes` throws `RangeError`.

**`createCollectionDb(version?)`** returns an empty database. The version defaults to `DEFAULT_COLLECTION_DB_VERSION` (20150203). A version that isn't an integer from -2^31 to 2^31 - 1 throws `invalid_version`.

**`normalizeHash(value)`** returns the hash in lowercase when it's exactly 32 hex characters in any case, else null. It never trims. Lazer matches hashes exactly, so an uppercase hash would never match anything.

**`collectionHashesFor(beatmaps)`** takes anything with a `checksum` (`BeatmapMeta`, osu!'s beatmap rows, your own objects) and returns `{ hashes, withoutChecksum }`: the normalized hashes, deduplicated in input order, and the items whose checksum is null, missing or malformed.

**`addToCollection(db, name, hashes)`** returns `{ db, index, created, added, alreadyPresent, similarName }`.

- It adds to the first collection whose name is exactly `name`, or creates the collection at the end. Nothing is trimmed and case counts, the way lazer matches.
- A new name must not be empty, start or end with whitespace, or hold control characters or lone surrogates (`invalid_name`), and must be at most 127 UTF-8 bytes (`name_too_long`). For a new collection in a stable file, trim what the user typed before you call it. Existing names aren't checked, so you can always add to a collection that's already in the file. For lazer, skip this function and use the name as typed (see [Getting collections into osu!lazer](#getting-collections-into-osulazer)).
- `hashes` is an array or any other iterable of hashes. A single string throws `TypeError`, since it would otherwise be read one character at a time: pass `[hash]`. TypeScript rejects a string there too.
- Every hash must be 32 hex characters, else `invalid_hash` with the hash's position in `hashes`. Hashes are lowercased, and ones the collection already holds are skipped and counted in `alreadyPresent` (repeats in `hashes` too). An uppercase hash already in the file doesn't count as present, since lazer never matches it.
- Existing entries are never removed or reordered, hashes for missing maps included.
- `similarName`, set only when it created the collection, is an existing name equal to `name` apart from case, outer whitespace or Unicode form ("Farm" when you asked for "farm"). Ask the user before you make a second collection.

**`mergeCollections(target, source)`** merges another file, like a shared collection pack, into `target` with lazer's import rules: each source collection goes into the target collection with the same exact name, or is created at the end. It returns `{ db, created, added, alreadyPresent, invalid }`. Source names are used as they are. Source hashes that aren't 32 hex characters are skipped and counted in `invalid`. A source collection that isn't `{ name, hashes: [...] }` throws `TypeError`. Its time grows with the number of hashes, however often a name repeats in the source. One difference from lazer: lazer keeps a hash that repeats inside a collection it creates from the file, and this never adds a hash a collection already holds.

**`lazerImportFiles(db)`** returns `[{ path: "collection.db", bytes }, { path: "osu!.import.cfg", bytes }]`, the second one empty. It throws whatever `writeCollectionDb` throws.

None of these change their arguments. Each returns new objects, so a call whose result you throw away is a preview.

### Errors and warnings

A `CollectionDbError` has a `code`, and `offset` (the byte in the file, for read errors), `collection` (its index) and `hash` (its place in that collection's list in the file, null hashes included, or in the `hashes` you passed to `addToCollection`) when they apply, else null. Messages name the field and position but never a collection name or hash, so they're safe to log. Branch on the codes you know; later versions may add codes.

| Code | When |
| --- | --- |
| `too_large` | The input or output is over `maxBytes`, or a file's counts add up to more than `maxBytes / 34` collections and hashes. |
| `truncated` | The file ends partway through a field, or is under 8 bytes. |
| `bad_count` | A negative collection or hash count, or one the bytes left can't hold (at least 5 bytes per collection, 1 per hash). Each count is checked before its entries are read. |
| `bad_marker` | A string marker other than `0x00` or `0x0b` (not in lenient mode). |
| `bad_length` | A string length longer than 5 bytes, over 2^31 - 1, or running past the end. |
| `invalid_utf8` | A name or hash that isn't valid UTF-8 (not in lenient mode). |
| `trailing_bytes` | Bytes after the last collection (not in lenient mode). Often the wrong file, like `osu!.db`. |
| `invalid_version` | A version that isn't an integer from -2^31 to 2^31 - 1. |
| `invalid_name` | A name that isn't a string or holds a lone surrogate, or a new name that breaks the rules above. |
| `name_too_long` | A new name over 127 UTF-8 bytes. |
| `invalid_hash` | A hash that isn't a string (writing), or isn't 32 hex characters (`addToCollection`). |

Don't read `truncated` as "incomplete" and `bad_count` as "wrong file". A file cut off soon after a count fails that count's check and reports `bad_count`, one cut off further along reports `truncated`, and the wrong file can fail with any read code. For every read code but `too_large`, tell the user the file isn't a readable `collection.db` and to pick the one in their osu! folder.

Each warning is `{ code, offset, collection, hash }`. `hash` is the index into that collection's `hashes`, so `collections[collection].hashes[hash]` is the entry the warning is about. It's null for a warning about a name, and for `null_hash`, since that entry was dropped: `offset` still says where it was in the file. A read lists the first 1,000 warnings and counts the rest in `omittedWarnings`.

| Warning | Meaning | Kept? |
| --- | --- | --- |
| `null_name` | A null name marker (`0x00`). | Read as `""`, written as an empty string. |
| `empty_name` | An empty name. | Yes |
| `duplicate_name` | The same exact name as an earlier collection. | Yes |
| `null_hash` | A null hash marker. | Dropped |
| `duplicate_hash` | The same hash earlier in this collection. | Yes |
| `uppercase_hash` | 32 hex characters with some uppercase. Lazer won't match it. | Yes, unchanged |
| `malformed_hash` | Not 32 hex characters. | Yes, unchanged |
| `unknown_marker` | Lenient only: a marker other than `0x00` or `0x0b`, read as a string. | Yes |
| `invalid_utf8` | Lenient only: invalid UTF-8, replaced with U+FFFD. | Yes, changed |
| `trailing_bytes` | Lenient only: bytes after the last collection. | Dropped |

### Collections exports

| Export | What it is |
| --- | --- |
| `readCollectionDb`, `ReadCollectionDbOptions`, `CollectionDbRead` | The reader, its options, and its result. |
| `CollectionDbWarning`, `CollectionDbWarningCode` | A reader warning and its `code` values. |
| `writeCollectionDb` | The writer. |
| `createCollectionDb`, `normalizeHash`, `collectionHashesFor`, `addToCollection`, `mergeCollections`, `lazerImportFiles` | The helpers above. |
| `CollectionDb`, `OsuCollection` | `{ version, collections }` and `{ name, hashes }`. |
| `CollectionDbError`, `CollectionDbErrorCode` | The error, and its `code` values. `new CollectionDbError(code, message, { offset, collection, hash })` builds one, for tests. |
| `MAX_COLLECTION_DB_BYTES`, `MAX_COLLECTION_NAME_BYTES`, `DEFAULT_COLLECTION_DB_VERSION`, `COLLECTION_DB_FILENAME` | 64 MiB, 127, 20150203, and `"collection.db"`. |

## Compatibility

- **Node** 22.12 or later. CI runs the built package on Node 22.12 and 24.
- **Bun** runs it too. CI tests on Node only.
- **Browsers:** import only `@haruhimemoe/osu/shapes` and `@haruhimemoe/osu/collections`. Keep `createOsuClient` on a server, since it holds your client secret. The client uses web-standard APIs (`fetch`, `AbortSignal.timeout`, `URL`) and no Node built-ins. `/collections` uses only `TextEncoder`, `TextDecoder` and `DataView`.
- **`zod`** is a peer dependency, `^4.0.16`. CI checks a consumer against zod 4.0.16 and the newest release.
- **TypeScript:** your config needs the `DOM` lib or `@types/node`, since the client's types use `URL`, `Response` and `RequestInit`, and zod's own types use `URL`. `moduleResolution` must be `node16`, `nodenext` or `bundler`: `@haruhimemoe/osu/shapes` and `@haruhimemoe/osu/collections` resolve only through the package's `exports` map, which the legacy `node` (`node10`) setting ignores. The `/collections` types use `Uint8Array<ArrayBuffer>`, which needs TypeScript 5.7 or later. The root entry point re-exports `/collections`, so importing anything from `@haruhimemoe/osu`, even just `createOsuClient`, needs TypeScript 5.7 too. On older TypeScript, set `skipLibCheck: true`. `@haruhimemoe/osu/shapes` alone works either way.

## License

MIT. See [LICENSE](LICENSE). Not affiliated with osu! or ppy Pty Ltd. Using the osu! API means following its [terms of use](https://osu.ppy.sh/docs/#terms-of-use).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup and how to submit a change, [CHANGELOG.md](CHANGELOG.md) for release history, and [SECURITY.md](SECURITY.md) to report a vulnerability.
