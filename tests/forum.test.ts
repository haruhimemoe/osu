/**
 * @file tests/forum.test.ts
 * @desc Forum lookups: a topic page with sort, limit and cursor; null on 404; one post by topic
 *       and post id (null when the topic doesn't hold it); a topic list; the budget; bad ids and
 *       limits refused before any call.
 * @author David @dvhsh (https://dvh.sh)
 * @created Sun Oct 11, 2026
 * @modified Sun Oct 11, 2026
 */

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOsuClient } from "../src/index.js";

const TOPIC = {
  id: 10,
  forum_id: 55,
  title: "T",
  user_id: 2,
  post_count: 3,
  created_at: "2026-01-01T00:00:00Z",
  first_post_id: 100,
  last_post_id: 102,
  is_locked: false,
  type: "normal",
};
const POST = (id: number) => ({
  id,
  topic_id: 10,
  forum_id: 55,
  user_id: 2,
  created_at: "2026-01-01T00:00:00Z",
  edited_at: null,
  body: { raw: `post ${id}`, html: `post ${id}` },
});
const ALL = [POST(100), POST(101), POST(102)];

let requests: URL[] = [];
const server = setupServer(
  http.post("https://osu.ppy.sh/oauth/token", () =>
    HttpResponse.json({ expires_in: 86400, access_token: "t" }),
  ),
  http.get("https://osu.ppy.sh/api/v2/forums/topics/:id", ({ request, params }) => {
    const url = new URL(request.url);
    requests.push(url);
    if (params.id !== "10") return new HttpResponse(null, { status: 404 });
    // Like osu!: start seeks to the first post at or after that id.
    const start = Number(url.searchParams.get("start") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const posts = ALL.filter((post) => post.id >= start).slice(0, limit);
    return HttpResponse.json({
      topic: TOPIC,
      posts,
      cursor_string: posts.length < ALL.length ? "next" : null,
    });
  }),
  http.get("https://osu.ppy.sh/api/v2/forums/topics", ({ request }) => {
    requests.push(new URL(request.url));
    return HttpResponse.json({ topics: [TOPIC], cursor_string: "c2" });
  }),
);

const client = () =>
  createOsuClient({
    credentials: { clientId: "1", clientSecret: "s" },
    userAgent: "t",
    retry: false,
  });

beforeAll(() => server.listen());
beforeEach(() => {
  requests = [];
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("getForumTopic", () => {
  it("sends sort, limit and cursor", async () => {
    const page = await client().getForumTopic(10, { sort: "id_asc", limit: 2, cursor: "abc" });
    expect(page?.posts.map((post) => post.id)).toEqual([100, 101]);
    expect(page?.cursor).toBe("next");
    const query = requests[0]?.searchParams;
    expect([query?.get("sort"), query?.get("limit"), query?.get("cursor_string")]).toEqual([
      "id_asc",
      "2",
      "abc",
    ]);
  });

  it("sends nothing it wasn't given", async () => {
    await client().getForumTopic(10);
    expect([...(requests[0]?.searchParams.keys() ?? [])]).toEqual([]);
  });

  it("returns null on 404", async () => {
    expect(await client().getForumTopic(99)).toBeNull();
  });

  it("refuses bad ids and limits before any call", async () => {
    await expect(client().getForumTopic(0)).rejects.toThrow(RangeError);
    await expect(client().getForumTopic(10, { limit: 51 })).rejects.toThrow(RangeError);
    await expect(client().getForumTopic(10, { limit: 0 })).rejects.toThrow(RangeError);
    expect(requests).toEqual([]);
  });

  it("asks the budget", async () => {
    await expect(
      client().getForumTopic(10, { beforeCall: async () => false }),
    ).rejects.toMatchObject({ code: "budget" });
    expect(requests).toEqual([]);
  });
});

describe("getForumPost", () => {
  it("finds a post by topic and post id", async () => {
    expect(await client().getForumPost({ topicId: 10, postId: 101 })).toMatchObject({
      id: 101,
      body: { raw: "post 101" },
    });
    const query = requests[0]?.searchParams;
    expect([query?.get("sort"), query?.get("start"), query?.get("limit")]).toEqual([
      "id_asc",
      "101",
      "1",
    ]);
  });

  it("returns null when the topic doesn't hold that post, never another post", async () => {
    expect(await client().getForumPost({ topicId: 10, postId: 99 })).toBeNull();
    expect(await client().getForumPost({ topicId: 10, postId: 555 })).toBeNull();
  });

  it("returns null for a missing topic", async () => {
    expect(await client().getForumPost({ topicId: 99, postId: 1 })).toBeNull();
  });

  it("refuses a bad post id before any call", async () => {
    await expect(client().getForumPost({ topicId: 10, postId: -1 })).rejects.toThrow(RangeError);
    expect(requests).toEqual([]);
  });
});

describe("listForumTopics", () => {
  it("sends forum_id, sort, limit and cursor", async () => {
    const list = await client().listForumTopics({
      forumId: 55,
      sort: "new",
      limit: 5,
      cursor: "c1",
    });
    expect(list).toMatchObject({ topics: [{ id: 10 }], cursor: "c2" });
    const query = requests[0]?.searchParams;
    expect([
      query?.get("forum_id"),
      query?.get("sort"),
      query?.get("limit"),
      query?.get("cursor_string"),
    ]).toEqual(["55", "new", "5", "c1"]);
  });

  it("works with no options", async () => {
    expect((await client().listForumTopics()).topics).toHaveLength(1);
  });

  it("refuses a bad forum id before any call", async () => {
    await expect(client().listForumTopics({ forumId: 1.5 })).rejects.toThrow(RangeError);
    expect(requests).toEqual([]);
  });

  it("asks the budget", async () => {
    await expect(client().listForumTopics({ beforeCall: async () => false })).rejects.toMatchObject(
      { code: "budget" },
    );
  });

  it("throws an OsuApiError on an error status", async () => {
    server.use(
      http.get(
        "https://osu.ppy.sh/api/v2/forums/topics",
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    await expect(client().listForumTopics()).rejects.toMatchObject({
      code: "http_error",
      status: 500,
    });
  });
});
