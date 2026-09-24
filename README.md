# @haruhimemoe/osu

osu! API v2 for the haruhime.moe tools (packs, pools, sheets), in two parts:

- **`@haruhimemoe/osu/shapes`**: the data. Zod schemas and types for a difficulty (`BeatmapMeta` and osu!'s beatmap row), a beatmapset's content fields, and the signed-in user, plus osu! links and the sign-in endpoints. No client code, so it's safe in browsers and in other packages that read osu!-shaped data, like mirrors.
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

The root entry point also re-exports everything in `/shapes`.

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

## Compatibility

- **Node** 22.12 or later. CI runs the built package on Node 22.12 and 24.
- **Bun** runs it too. CI tests on Node only.
- **Browsers:** import only `@haruhimemoe/osu/shapes`. Keep `createOsuClient` on a server, since it holds your client secret. The client uses web-standard APIs (`fetch`, `AbortSignal.timeout`, `URL`) and no Node built-ins.
- **`zod`** is a peer dependency, `^4.0.16`. CI checks a consumer against zod 4.0.16 and the newest release.
- **TypeScript:** your config needs the `DOM` lib or `@types/node`, since the client's types use `URL`, `Response` and `RequestInit`, and zod's own types use `URL`. `moduleResolution` must be `node16`, `nodenext` or `bundler`: `@haruhimemoe/osu/shapes` resolves only through the package's `exports` map, which the legacy `node` (`node10`) setting ignores.

## License

MIT. See [LICENSE](LICENSE). Not affiliated with osu! or ppy Pty Ltd. Using the osu! API means following its [terms of use](https://osu.ppy.sh/docs/#terms-of-use).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup and how to submit a change, [CHANGELOG.md](CHANGELOG.md) for release history, and [SECURITY.md](SECURITY.md) to report a vulnerability.
