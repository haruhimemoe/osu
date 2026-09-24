/**
 * @file scripts/smoke.mjs
 * @desc Imports the built package the way apps will: every entry point, the client talking to a
 *       stub fetch (token, then beatmaps), /shapes without the client, and /collections writing
 *       and reading TV2 with Node's Buffer hidden, as in a browser. Run by `bun run test:dist`
 *       after a build.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Thu Sep 24, 2026
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as collections from "../dist/collections/index.js";
import { createOsuClient, readCollectionDb } from "../dist/index.js";
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

// TV2 from tests/collection-vectors.ts: version 20210520, "Farm" holding two hashes.
const TV2 =
  "58633401010000000b044661726d020000000b20643431643863643938663030623230346539383030" +
  "39393865636638343237650b203063633137356239633066316236613833316333393965323639373732363631";
const toHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
assert.equal("createOsuClient" in collections, false, "/collections has no client");
assert.equal("beatmapMetaSchema" in collections, false, "/collections has no shapes");
assert.equal(readCollectionDb, collections.readCollectionDb, "the root re-exports /collections");
const bufferProperty = Object.getOwnPropertyDescriptor(globalThis, "Buffer");
delete globalThis.Buffer;
try {
  const db = {
    version: 20210520,
    collections: [
      {
        name: "Farm",
        hashes: ["d41d8cd98f00b204e9800998ecf8427e", "0cc175b9c0f1b6a831c399e269772661"],
      },
    ],
  };
  const bytes = collections.writeCollectionDb(db);
  assert.equal(toHex(bytes), TV2);
  const read = collections.readCollectionDb(bytes);
  assert.deepEqual({ version: read.version, collections: read.collections }, db);
  const added = collections.addToCollection(read, "練習", read.collections[0].hashes);
  assert.equal(added.created, true);
  const files = collections.lazerImportFiles(added.db);
  assert.deepEqual(
    files.map((file) => file.path),
    ["collection.db", "osu!.import.cfg"],
  );
} finally {
  Object.defineProperty(globalThis, "Buffer", bufferProperty);
}
console.log("smoke: ok");
