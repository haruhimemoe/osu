/**
 * @file tests/forum-shapes.test.ts
 * @desc Forum shapes: a topic page (posts with and without a body), a topic list, cursors, the
 *       captured live answers, and parseForumUrl for topic, topic-with-post and post links.
 * @author David @dvhsh (https://dvh.sh)
 * @created Sun Oct 11, 2026
 * @modified Sun Oct 11, 2026
 */

import { describe, expect, it } from "vitest";
import { parseForumUrl, toOsuForumTopicList, toOsuForumTopicPage } from "../src/shapes/index.js";
import topicFixture from "./fixtures/forum-topic.json" with { type: "json" };
import listFixture from "./fixtures/forum-topics.json" with { type: "json" };

const TOPIC = {
  id: 10,
  forum_id: 55,
  title: "T",
  user_id: 2,
  post_count: 2,
  created_at: "2026-01-01T00:00:00Z",
  first_post_id: 100,
  last_post_id: 101,
  is_locked: false,
  type: "normal",
  extra: "dropped",
};
const POST = (id: number, body: unknown) => ({
  id,
  topic_id: 10,
  forum_id: 55,
  user_id: 2,
  created_at: "2026-01-01T00:00:00Z",
  edited_at: null,
  body,
});

describe("forum shapes", () => {
  it("maps a topic page to camelCase", () => {
    const page = toOsuForumTopicPage({
      topic: TOPIC,
      posts: [POST(100, { raw: "[b]x[/b]", html: "<b>x</b>" })],
      cursor_string: "abc",
    });
    expect(page.topic).toEqual({
      id: 10,
      forumId: 55,
      title: "T",
      userId: 2,
      postCount: 2,
      createdAt: "2026-01-01T00:00:00Z",
      firstPostId: 100,
      lastPostId: 101,
      isLocked: false,
      type: "normal",
    });
    expect(page.posts[0]).toMatchObject({ id: 100, topicId: 10, body: { raw: "[b]x[/b]" } });
    expect(page.cursor).toBe("abc");
  });

  it("keeps a post with no body as body null", () => {
    const page = toOsuForumTopicPage({
      topic: TOPIC,
      posts: [POST(100, undefined), POST(101, null)],
      cursor_string: null,
    });
    expect(page.posts.map((p) => p.body)).toEqual([null, null]);
  });

  it("maps a topic list", () => {
    expect(toOsuForumTopicList({ topics: [TOPIC], cursor_string: null })).toEqual({
      topics: [expect.objectContaining({ id: 10 })],
      cursor: null,
    });
  });

  it("reads the captured live answers", () => {
    const page = toOsuForumTopicPage(topicFixture);
    expect(page.posts.length).toBe(3);
    expect(page.posts[0]?.body?.raw.length).toBeGreaterThan(0);
    expect(toOsuForumTopicList(listFixture).topics.length).toBe(3);
  });

  it("parses forum links", () => {
    expect(parseForumUrl("https://osu.ppy.sh/community/forums/topics/123")).toEqual({
      topicId: 123,
      postId: null,
    });
    expect(parseForumUrl("https://osu.ppy.sh/community/forums/topics/123?start=456")).toEqual({
      topicId: 123,
      postId: 456,
    });
    expect(parseForumUrl("https://osu.ppy.sh/community/forums/posts/456")).toEqual({
      topicId: null,
      postId: 456,
    });
    expect(parseForumUrl("https://osu.ppy.sh/forum/t/123")).toEqual({ topicId: 123, postId: null });
    expect(parseForumUrl("https://osu.ppy.sh/forum/p/456")).toEqual({ topicId: null, postId: 456 });
    expect(parseForumUrl("https://evil.example/community/forums/topics/1")).toBeNull();
    expect(parseForumUrl("https://osu.ppy.sh/community/forums/topics/0")).toBeNull();
    expect(parseForumUrl("not a url")).toBeNull();
  });
});
