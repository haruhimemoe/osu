/**
 * @file tests/user.test.ts
 * @desc /api/v2/me to OsuUser: country fallbacks, a missing avatar, and refusing a profile with no
 *       identity.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Wed Sep 23, 2026
 */

import { describe, expect, it } from "vitest";
import { toOsuUser } from "../src/index.js";

const PROFILE = {
  id: 2,
  username: "peppy",
  avatar_url: "https://a.ppy.sh/2?1.jpeg",
  country_code: "AU",
  country: { code: "AU", name: "Australia" },
  is_bot: false,
};

describe("toOsuUser", () => {
  it("maps the profile", () => {
    expect(toOsuUser(PROFILE)).toEqual({
      osuId: 2,
      username: "peppy",
      avatarUrl: "https://a.ppy.sh/2?1.jpeg",
      countryCode: "AU",
    });
  });

  it("falls back to country_code, then to null", () => {
    expect(toOsuUser({ ...PROFILE, country: null }).countryCode).toBe("AU");
    expect(
      toOsuUser({ ...PROFILE, country: undefined, country_code: undefined }).countryCode,
    ).toBeNull();
  });

  it("keeps a missing avatar as null", () => {
    expect(toOsuUser({ ...PROFILE, avatar_url: null }).avatarUrl).toBeNull();
  });

  it("refuses a profile with no id instead of merging strangers into one account", () => {
    expect(() => toOsuUser({ username: "nobody" })).toThrow();
  });
});
