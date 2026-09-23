/**
 * @file tests/exports.test.ts
 * @desc The public surface of both entry points, so an accidental export or removal shows up in
 *       review as a semver question, and /shapes never grows client code.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Wed Sep 23, 2026
 */

import { expect, it } from "vitest";
import * as api from "../src/index.js";
import * as shapes from "../src/shapes/index.js";

it("exports the documented runtime API", () => {
  expect(Object.keys(api).sort()).toMatchInlineSnapshot(`
    [
      "BEATMAPSET_FALLBACK_LIMIT",
      "OSU_BASE_URL",
      "OSU_BEATMAPS_BATCH_LIMIT",
      "OSU_OAUTH",
      "OSU_SIGN_IN_SCOPES",
      "OSU_TIMEOUT_MS",
      "OsuApiError",
      "RULESETS",
      "beatmapMetaSchema",
      "beatmapUrl",
      "beatmapsetUrl",
      "coverUrl",
      "createOsuClient",
      "isExtendedBeatmapset",
      "osuBeatmapRowSchema",
      "osuBeatmapsetRowSchema",
      "osuBeatmapsetSchema",
      "osuUserSchema",
      "rulesetSchema",
      "toBeatmapMeta",
      "toOsuUser",
      "userUrl",
    ]
  `);
});

it("keeps the client out of /shapes", () => {
  expect(Object.keys(shapes)).not.toContain("createOsuClient");
  expect(
    Object.keys(api)
      .filter((name) => !(name in shapes))
      .sort(),
  ).toEqual([
    "BEATMAPSET_FALLBACK_LIMIT",
    "OSU_BEATMAPS_BATCH_LIMIT",
    "OSU_TIMEOUT_MS",
    "OsuApiError",
    "createOsuClient",
  ]);
});
