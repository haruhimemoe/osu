# @haruhimemoe/osu

osu! API v2 for the haruhime.moe tools (packs, pools, sheets), in two parts:

- **`@haruhimemoe/osu/shapes`**: the data. Zod schemas and types for a difficulty (`BeatmapMeta` and osu!'s beatmap row), a beatmapset's content fields, and the signed-in user, plus osu! links and the sign-in endpoints. No client code, so it's safe in browsers and in other packages that read osu!-shaped data, like mirrors.
- **`@haruhimemoe/osu`**: everything above, plus `createOsuClient` for servers. It caches the client-credentials token, sends your User-Agent, and has a hook for a shared rate budget. It fetches beatmaps, beatmapsets and star ratings with mods.

## Install

```sh
bun add @haruhimemoe/osu zod
```

`zod` (4.0.16 or later in 4.x) is a peer dependency. CI checks a consumer against 4.0.16 and the newest zod.

## The client

```ts
import { createOsuClient } from "@haruhimemoe/osu";

// One client per process: the token is cached on it.
export const osu = createOsuClient({
  userAgent: "my-tool (+https://example.com; me@example.com)",
  credentials: () => ({ clientId: env.OSU_CLIENT_ID, clientSecret: env.OSU_CLIENT_SECRET }),
});

await osu.getBeatmaps([129891, 75]); // { found: Map<id, BeatmapMeta>, missing: [], unchecked: [] }
await osu.getStarRating(129891, ["HD", "HR"]); // 8.61, or null for a missing map or unratable mods
await osu.getBeatmapsets([129891]); // { sets: Map<beatmapId, the set's content fields>, unchecked: [] }
```

- **Keep it on the server.** It holds your client secret. Browsers use `/shapes` and ask your server. Its types use `fetch`'s `Response` and `RequestInit`, so your TypeScript config needs the `DOM` lib or `@types/node`, as any fetch-based code does.
- **`userAgent`** names your app and how to reach you. It goes on every request, the token request included.
- **`credentials`** can be an object or a function. Both must give two non-empty strings, else you get a `TypeError` that names the field but not its value. A function is called on every token request (the first call, each daily refresh, and after a 401), never at import, so importing the module never needs env and a rotated secret is picked up. If it throws, its error reaches you unchanged.
- **`baseUrl`** (default `https://osu.ppy.sh`) also receives your client secret, because token requests go there. Point it only at osu! itself or your own test server, never at a mirror. It must be `https`, or `http` on `localhost` / `127.0.0.1`, else `createOsuClient` throws a `RangeError`.
- **`timeoutMs`** (default 10 s): each request, answer and body, gives up after this long, so a hung osu! call can't hold a serverless function. It must be an integer from 1 to 2147483647, else `RangeError`.
- **`fetch`** and **`now`** replace `globalThis.fetch` and the token clock, for tests.
- **Errors:** every failure talking to osu! is an `OsuApiError` with a `code`, the HTTP `status` (null when there was none), `retryAfterMs`, and the underlying error as `cause`. Codes: `"timeout"`, `"network"`, `"bad_response"` (not JSON, or not the expected shape), `"http_error"`, and `"budget"` (only `getStarRating`, below). Branch on the ones you know; later versions may add codes. `retryAfterMs` is osu!'s `Retry-After` on a 429 or 503, capped at 60 s, else null. A 401 is retried once with a fresh token. Other errors are yours: bad arguments throw `RangeError` and bad credentials `TypeError`, both before anything is sent, and an error thrown by your `credentials` function or `beforeCall` comes through unchanged.
- **`getBeatmaps(ids, { beforeCall })`** asks `/beatmaps` 50 ids at a time and returns `{ found, missing, unchecked }`:
  - `found`: `BeatmapMeta` by id.
  - `missing`: ids that aren't positive integers (never sent), and ids osu! answered no row for (unless that batch had a row without a readable `id`, below).
  - `unchecked`: ids in a batch `beforeCall` refused; ids whose row osu! sent but that fails our schema; and, when a row in a batch has no readable `id`, every id in that batch without a good row (we can't tell which one it was).
  - It throws when the token request fails, or a `/beatmaps` call answers an error status (after the one 401 retry), sends a body that isn't `{ beatmaps: [...] }`, times out, or can't reach osu!. The whole call throws, and batches already fetched are lost.
- **`getBeatmapsets(ids, { beforeCall, fallbackLimit })`** returns `{ sets, unchecked }`. `sets` is keyed by beatmap (difficulty) id, not set id, and sibling difficulties share one set object. Each set holds the content fields in `OsuBeatmapsetExtended`, not osu!'s whole object. It asks `/beatmaps` 50 ids at a time. When a row's set comes compact, it asks `/beatmapsets/{id}` for that set, at most `fallbackLimit` times per call (10 by default; 0 makes no fallback calls).
  - `unchecked`: ids in a `/beatmaps` batch `beforeCall` refused; ids whose row fails our schema (every id of the batch without a good row, when a row has no readable `id`); ids whose set came compact and wasn't looked up because `fallbackLimit` was spent or `beforeCall` refused; and ids whose `/beatmapsets/{id}` lookup failed any way but a 404: an error status, a failed token request, a timeout, a network failure, or a body that isn't a readable, extended set. A failed lookup still counts against `fallbackLimit`, and the call keeps the sets it already has.
  - In neither: ids that aren't positive integers (never sent), ids osu! answered no row for (same exception as `getBeatmaps`), and ids whose set lookup answered 404 (the set is gone).
  - It throws `RangeError` for a `fallbackLimit` that isn't a non-negative integer, before anything is sent. It throws `OsuApiError` when the token request before a `/beatmaps` call fails, or a `/beatmaps` call fails as in `getBeatmaps`. A failed fallback lookup never throws an `OsuApiError`.
- **`getStarRating(id, mods, { beforeCall })`** makes one call (plus the 401 retry). It returns null when osu! answers 404 or 422, and rejects with code `"budget"` when `beforeCall` refuses.

### Staying under osu!'s rate limit

osu! asks API users to stay at or under 60 requests a minute, and to cache what they fetch. Budget per OAuth app, not per request handler: if several features or serverless instances share one app, give them one counter. By default there is no budget: `getBeatmaps` with 5,000 ids makes 100 calls back to back. Pass `beforeCall` to all three methods. They ask it before each planned osu! call and skip the call when it returns false: `getBeatmaps` and `getBeatmapsets` put that call's ids in `unchecked`, and `getStarRating` rejects with code `"budget"`. Token requests aren't counted, and neither is the one retry after a 401, so an approved call can cost one more API call plus a token request. Leave headroom for that.

```ts
// A fixed-window counter shared by every instance (MongoDB 7 driver here; any atomic store works).
type Counter = { _id: string; count: number; expiresAt: Date };
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

await osu.getBeatmapsets(ids, { beforeCall });
await osu.getStarRating(129891, ["HD"], { beforeCall });
```

### Client exports

| Export | What it is |
| --- | --- |
| `createOsuClient`, `OsuClient`, `OsuClientOptions`, `OsuCredentials` | The client, its type, its options, and the `{ clientId, clientSecret }` pair. |
| `BeatmapLookup`, `BeatmapOptions` | `getBeatmaps`' result and options. |
| `BeatmapsetLookup`, `BeatmapsetOptions` | `getBeatmapsets`' result and options. |
| `StarRatingOptions` | `getStarRating`'s options. |
| `OsuApiError`, `OsuApiErrorCode` | The error, and its `code` values. |
| `OSU_BEATMAPS_BATCH_LIMIT`, `BEATMAPSET_FALLBACK_LIMIT`, `OSU_TIMEOUT_MS` | 50 ids per `/beatmaps` call, the default `fallbackLimit` (10), the default `timeoutMs` (10,000). |

The root entry point also re-exports everything in `/shapes`.

## Shapes

```ts
import { coverUrl, isExtendedBeatmapset, toOsuUser, type BeatmapMeta } from "@haruhimemoe/osu/shapes";
```

| Export | What it is |
| --- | --- |
| `BeatmapMeta`, `beatmapMetaSchema` | A difficulty: ids, ruleset, title, artist, version, creator, CS/AR/OD/HP, BPM, length, stars, md5 checksum. |
| `osuBeatmapRowSchema`, `OsuBeatmapRow`, `toBeatmapMeta` | osu!'s `/api/v2/beatmaps` row, and its mapping to `BeatmapMeta`. Mirrors that copy osu!'s shape parse the same way. |
| `RULESETS`, `Ruleset`, `rulesetSchema` | `osu`, `taiko`, `fruits`, `mania`. |
| `osuBeatmapsetSchema`, `OsuBeatmapset`, `OsuBeatmapsetExtended`, `isExtendedBeatmapset`, `osuBeatmapsetRowSchema` | A beatmapset's status, artist and title (with unicode forms), source, tags, Featured Artist `track_id` and `availability`. Extended means all of those are present. Pass an extended set to `@haruhimemoe/compliance`'s `factsFromOsuBeatmapset`. |
| `osuUserSchema`, `toOsuUser`, `OsuUser` | `/api/v2/me` reduced to `{ osuId, username, avatarUrl, countryCode }`. osu! never shares an email. |
| `OSU_OAUTH`, `OSU_SIGN_IN_SCOPES`, `OSU_BASE_URL` | Sign-in endpoints (authorize, token, `/me`) and scopes (`identify public`). |
| `coverUrl`, `CoverSize`, `beatmapUrl`, `beatmapsetUrl`, `userUrl` | osu! pages and cover art on assets.ppy.sh. |

## License

MIT. See [LICENSE](LICENSE). Not affiliated with osu! or ppy Pty Ltd. Using the osu! API means following its terms: https://osu.ppy.sh/docs#terms-of-use

## Develop

```sh
bun install
bun run check && bun run typecheck && bun run test && bun run test:dist
bun run check:consumer 4.0.16   # needs the npm registry
```

### Releasing

npm only lets you add a trusted publisher to a package that already exists, so the first release is manual. The owner publishes 0.1.0 from a clean checkout of the tagged commit: `bun run build`, every check above passing, then `npm publish --access public --provenance=false`. Next, configure the trusted publisher (needs npm 11.15.0 or later and 2FA): `npm trust github @haruhimemoe/osu --file release.yml --repo haruhimemoe/osu --env npm --allow-publish`. Every later release goes through `release.yml`: publish a GitHub release whose tag is `v` plus the `package.json` version. A version with a prerelease part (`0.2.0-rc.1`) goes to the `next` dist-tag, anything else to `latest`.
