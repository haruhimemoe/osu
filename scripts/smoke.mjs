/**
 * @file scripts/smoke.mjs
 * @desc Imports the built package the way apps will: both entry points, the client talking to a
 *       stub fetch (token, then beatmaps), and /shapes without the client. Run by
 *       `bun run test:dist` after a build.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Wed Sep 23, 2026
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createOsuClient } from "../dist/index.js";
import * as shapes from "../dist/shapes/index.js";

const fixture = JSON.parse(
  readFileSync(new URL("../tests/fixtures/beatmaps.json", import.meta.url)),
);
const seen = [];
const client = createOsuClient({
  userAgent: "smoke",
  credentials: { clientId: "1", clientSecret: "s" },
  fetch: async (input, init) => {
    seen.push(
      `${init?.method ?? "GET"} ${new URL(input).pathname} ${init?.headers?.["User-Agent"]}`,
    );
    return String(input).endsWith("/oauth/token")
      ? Response.json({ access_token: "t", expires_in: 86400 })
      : Response.json({ beatmaps: fixture.beatmaps });
  },
});
const { found } = await client.getBeatmaps([75]);
assert.equal(found.get(75)?.title, "DISCOPRINCE");
assert.deepEqual(seen, ["POST /oauth/token smoke", "GET /api/v2/beatmaps smoke"]);
assert.equal("createOsuClient" in shapes, false, "/shapes has no client");
assert.equal(shapes.coverUrl(1), "https://assets.ppy.sh/beatmaps/1/covers/card.jpg");
console.log("smoke: ok");
