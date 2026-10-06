/**
 * @file tests/matches.test.ts
 * @desc getMatch: an id or mp link, paging back with `before` to the first event, events
 *       de-duplicated and sorted, users merged, the budget per page, maxPages, a 404 before and
 *       after the first page, an empty older page, and bad input refused before any call.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Oct 6, 2026
 * @modified Tue Oct 6, 2026
 */

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOsuClient, OsuApiError } from "../src/index.js";
import pages from "./fixtures/match-pages.json" with { type: "json" };

const TOKEN_URL = "https://osu.ppy.sh/oauth/token";
const MATCH_URL = "https://osu.ppy.sh/api/v2/matches/:id";
const UA = "haruhime-osu-tests (+https://haruhime.moe)";

let requests: { url: URL; userAgent: string | null }[] = [];

const server = setupServer(
  http.post(TOKEN_URL, () => HttpResponse.json({ expires_in: 86400, access_token: "token" })),
  http.get(MATCH_URL, ({ request, params }) => {
    const url = new URL(request.url);
    requests.push({ url, userAgent: request.headers.get("user-agent") });
    if (params.id !== "111") return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(url.searchParams.has("before") ? pages.older : pages.newer);
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  requests = [];
});

const client = () =>
  createOsuClient({ credentials: { clientId: "1", clientSecret: "shh" }, userAgent: UA });

const asked = () => requests.map(({ url }) => url.pathname + url.search);

describe("getMatch", () => {
  it("pages back to the first event and returns the whole match", async () => {
    const result = await client().getMatch(111);
    expect(result?.complete).toBe(true);
    expect(asked()).toEqual([
      "/api/v2/matches/111?limit=100",
      "/api/v2/matches/111?before=5&limit=100",
    ]);
    expect(requests.every(({ userAgent }) => userAgent === UA)).toBe(true);
    expect(result?.match.events.map((event) => event.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result?.match).toMatchObject({
      id: 111,
      name: "EGC: (Red Team) vs (Blue Team)",
      startTime: "2026-10-03T18:00:00+00:00",
      endTime: "2026-10-03T18:59:00+00:00",
      firstEventId: 1,
      latestEventId: 9,
    });
    // Users from both pages, by id; the one without a username is left out.
    expect(result?.match.users.map((user) => user.osuId)).toEqual([2, 124493]);
  });

  it("de-duplicates events two pages both sent", async () => {
    server.use(
      http.get(MATCH_URL, ({ request }) => {
        const url = new URL(request.url);
        requests.push({ url, userAgent: null });
        if (!url.searchParams.has("before")) return HttpResponse.json(pages.newer);
        return HttpResponse.json({
          ...pages.older,
          events: [...pages.older.events, pages.newer.events[0]],
        });
      }),
    );
    const result = await client().getMatch(111);
    expect(result?.match.events.map((event) => event.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("takes mp links and numeric strings", async () => {
    const osu = client();
    for (const link of ["https://osu.ppy.sh/community/matches/111", "osu.ppy.sh/mp/111", " 111 "]) {
      expect((await osu.getMatch(link))?.match.id).toBe(111);
    }
  });

  it("asks beforeCall once per page, and stops with complete: false when it refuses a later one", async () => {
    let calls = 0;
    const result = await client().getMatch(111, {
      beforeCall: async () => {
        calls += 1;
        return calls === 1;
      },
    });
    expect(calls).toBe(2);
    expect(result?.complete).toBe(false);
    expect(result?.match.events.map((event) => event.id)).toEqual([5, 6, 7, 8, 9]);
    expect(result?.match.users.map((user) => user.osuId)).toEqual([2, 124493]);
    expect(requests).toHaveLength(1);
  });

  it("rejects with code budget when beforeCall refuses the first page", async () => {
    const error = await client()
      .getMatch(111, { beforeCall: async () => false })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OsuApiError);
    expect((error as OsuApiError).code).toBe("budget");
    expect(requests).toHaveLength(0);
  });

  it("stops at maxPages with complete: false", async () => {
    const result = await client().getMatch(111, { maxPages: 1 });
    expect(result?.complete).toBe(false);
    expect(requests).toHaveLength(1);
  });

  it("is whole when the first page reaches the first event", async () => {
    server.use(http.get(MATCH_URL, () => HttpResponse.json({ ...pages.newer, first_event_id: 5 })));
    expect((await client().getMatch(111))?.complete).toBe(true);
  });

  it("is whole when an older page comes back empty, or no older", async () => {
    for (const events of [[], pages.newer.events]) {
      server.use(
        http.get(MATCH_URL, ({ request }) => {
          requests.push({ url: new URL(request.url), userAgent: null });
          return HttpResponse.json(
            new URL(request.url).searchParams.has("before")
              ? { ...pages.older, events }
              : pages.newer,
          );
        }),
      );
      requests = [];
      const result = await client().getMatch(111);
      expect(result?.complete).toBe(true);
      expect(requests).toHaveLength(2);
    }
  });

  it("returns a match without events as whole", async () => {
    server.use(
      http.get(MATCH_URL, () =>
        HttpResponse.json({ ...pages.newer, events: [], first_event_id: 0, latest_event_id: 0 }),
      ),
    );
    const result = await client().getMatch(111);
    expect(result).toEqual(expect.objectContaining({ complete: true }));
    expect(result?.match.events).toEqual([]);
  });

  it("returns null for a match osu! doesn't have", async () => {
    expect(await client().getMatch(404)).toBeNull();
  });

  it("throws on a 404 after the first page", async () => {
    server.use(
      http.get(MATCH_URL, ({ request }) =>
        new URL(request.url).searchParams.has("before")
          ? new HttpResponse(null, { status: 404 })
          : HttpResponse.json(pages.newer),
      ),
    );
    const error = await client()
      .getMatch(111)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "http_error", status: 404 });
  });

  it("throws on an error status or a body that isn't a match", async () => {
    server.use(http.get(MATCH_URL, () => new HttpResponse(null, { status: 500 })));
    await expect(client().getMatch(111)).rejects.toMatchObject({ code: "http_error", status: 500 });
    server.use(http.get(MATCH_URL, () => HttpResponse.json({ events: "no" })));
    await expect(client().getMatch(111)).rejects.toMatchObject({ code: "bad_response" });
  });

  it("refuses a bad id, link or maxPages before any call", async () => {
    const osu = client();
    for (const bad of [0, -1, 1.5, "", "abc", "https://example.com/mp/1"]) {
      await expect(osu.getMatch(bad)).rejects.toThrow(RangeError);
    }
    for (const maxPages of [0, 1.5, Number.NaN]) {
      await expect(osu.getMatch(111, { maxPages })).rejects.toThrow(RangeError);
    }
    expect(requests).toHaveLength(0);
  });
});
