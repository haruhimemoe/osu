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
  userAgent: "pools.haruhime.moe (+https://pools.haruhime.moe; contact@haruhime.moe)",
  credentials: () => ({ clientId: env.OSU_CLIENT_ID, clientSecret: env.OSU_CLIENT_SECRET }),
});

await osu.getBeatmaps([129891, 75]); // { found: Map<id, BeatmapMeta>, missing: [], unchecked: [] }
await osu.getStarRating(129891, ["HD", "HR"]); // 8.61, or null for a missing map or unratable mods
await osu.getBeatmapsets([129891]); // { sets: Map<beatmapId, the set's content fields>, unchecked: [] }
```

- **Keep it on the server.** It holds your client secret. Browsers use `/shapes` and ask your server. Its types use `fetch`'s `Response` and `RequestInit`, so your TypeScript config needs the `DOM` lib or `@types/node`, as any fetch-based code does.
- **`credentials`** can be an object or a function. A function is read on the first request, so importing the module never needs env.
- **Errors:** every failure is an `OsuApiError` with the HTTP `status`, or null when there was none (network failure, timeout), and the underlying error as `cause`. A 401 is retried once with a fresh token. `getStarRating` returns null for 404 and 422. Bad arguments (a non-integer id, a bad `fallbackLimit`) throw `RangeError` before anything is sent.
- **Timeouts:** each request gives up after `timeoutMs` (10 s by default), so a hung osu! call can't hold a serverless function.
- **`getBeatmaps`** returns `{ found, missing, unchecked }`: metadata by id, ids osu! doesn't know (or that aren't valid ids, which are never sent), and ids in batches `beforeCall` refused.
- **`getBeatmapsets`** returns each set's content fields (the ones in `OsuBeatmapsetExtended`, not osu!'s whole object). It asks `/beatmaps` 50 ids at a time. When a row's set is compact, it asks `/beatmapsets/{id}` for that set, at most `fallbackLimit` times per call (10 by default). A 404 means the set is gone. Anything else (a 429, a 5xx, a body it can't read) leaves that set's ids in `unchecked`, and the call keeps the sets it already has.

### Staying under osu!'s rate limit

osu! asks API users to stay at or under 60 requests a minute, and to cache what they fetch. Budget per OAuth app, not per request handler: if several features or serverless instances share one app, give them one counter. `getBeatmaps` and `getBeatmapsets` ask `beforeCall` before every osu! call and skip the call when it returns false. Its ids land in `unchecked`.

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
```

`getStarRating` makes exactly one call, so check the same budget before calling it.

## Shapes

```ts
import { coverUrl, isExtendedBeatmapset, toOsuUser, type BeatmapMeta } from "@haruhimemoe/osu/shapes";
```

| Export | What it is |
| --- | --- |
| `BeatmapMeta`, `beatmapMetaSchema` | A difficulty: ids, ruleset, title, artist, version, creator, CS/AR/OD/HP, BPM, length, stars, md5 checksum. |
| `osuBeatmapRowSchema`, `toBeatmapMeta` | osu!'s `/api/v2/beatmaps` row, and its mapping to `BeatmapMeta`. Mirrors that copy osu!'s shape parse the same way. |
| `RULESETS`, `Ruleset`, `rulesetSchema` | `osu`, `taiko`, `fruits`, `mania`. |
| `osuBeatmapsetSchema`, `OsuBeatmapset`, `OsuBeatmapsetExtended`, `isExtendedBeatmapset`, `osuBeatmapsetRowSchema` | A beatmapset's status, artist and title (with unicode forms), source, tags, Featured Artist `track_id` and `availability`. Extended means all of those are present. Pass an extended set to `@haruhimemoe/compliance`'s `factsFromOsuBeatmapset`. |
| `osuUserSchema`, `toOsuUser`, `OsuUser` | `/api/v2/me` reduced to `{ osuId, username, avatarUrl, countryCode }`. osu! never shares an email. |
| `OSU_OAUTH`, `OSU_SIGN_IN_SCOPES`, `OSU_BASE_URL` | Sign-in endpoints (authorize, token, `/me`) and scopes (`identify public`). |
| `coverUrl`, `beatmapUrl`, `beatmapsetUrl`, `userUrl` | osu! pages and cover art on assets.ppy.sh. |

## License

MIT. See [LICENSE](LICENSE). Not affiliated with osu! or ppy Pty Ltd. Using the osu! API means following its terms: https://osu.ppy.sh/docs#terms-of-use

## Develop

```sh
bun install
bun run check && bun run typecheck && bun run test && bun run test:dist
bun run check:consumer 4.0.16   # needs the npm registry
```
