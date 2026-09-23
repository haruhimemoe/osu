/**
 * @file tests/links.test.ts
 * @desc osu! asset and page URLs.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Tue Sep 22, 2026
 */

import { describe, expect, it } from "vitest";
import { beatmapsetUrl, beatmapUrl, coverUrl, OSU_OAUTH, userUrl } from "../src/index.js";

describe("osu links", () => {
  it("builds cover URLs on assets.ppy.sh", () => {
    expect(coverUrl(39804)).toBe("https://assets.ppy.sh/beatmaps/39804/covers/card.jpg");
    expect(coverUrl(39804, "list@2x")).toBe(
      "https://assets.ppy.sh/beatmaps/39804/covers/list@2x.jpg",
    );
  });

  it("builds beatmap and user page URLs", () => {
    expect(beatmapUrl(129891)).toBe("https://osu.ppy.sh/beatmaps/129891");
    expect(userUrl(87065)).toBe("https://osu.ppy.sh/users/87065");
    expect(beatmapsetUrl(39804)).toBe("https://osu.ppy.sh/beatmapsets/39804");
  });

  it("names the sign-in endpoints", () => {
    expect(OSU_OAUTH).toEqual({
      authorizationUrl: "https://osu.ppy.sh/oauth/authorize",
      tokenUrl: "https://osu.ppy.sh/oauth/token",
      userInfoUrl: "https://osu.ppy.sh/api/v2/me",
    });
  });
});
