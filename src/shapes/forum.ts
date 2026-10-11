/**
 * @file src/shapes/forum.ts
 * @desc osu! forum topics and posts (GET /api/v2/forums/topics...), as camelCase types, and
 *       parseForumUrl for topic and post links. Browser-safe.
 * @author David @dvhsh (https://dvh.sh)
 * @created Sun Oct 11, 2026
 * @modified Sun Oct 11, 2026
 */

import { z } from "zod";

const id = z.number().int().positive();

/** One forum post, in osu!'s snake_case. */
export const osuForumPostSchema = z.object({
  id,
  topic_id: id,
  forum_id: id,
  user_id: id.nullish(),
  created_at: z.string(),
  edited_at: z.string().nullish(),
  body: z.object({ raw: z.string(), html: z.string() }).nullish(),
});

/** One forum topic, in osu!'s snake_case. */
export const osuForumTopicSchema = z.object({
  id,
  forum_id: id,
  title: z.string(),
  user_id: id.nullish(),
  post_count: z.number().int().nonnegative(),
  created_at: z.string(),
  first_post_id: id,
  last_post_id: id,
  is_locked: z.boolean(),
  type: z.string(),
});

/** GET /api/v2/forums/topics/{id}: the topic, one page of its posts, the next page's cursor. */
export const osuForumTopicPageSchema = z.object({
  topic: osuForumTopicSchema,
  posts: z.array(osuForumPostSchema),
  cursor_string: z.string().nullish(),
});

/** GET /api/v2/forums/topics: one page of topics (no posts), the next page's cursor. */
export const osuForumTopicListSchema = z.object({
  topics: z.array(osuForumTopicSchema),
  cursor_string: z.string().nullish(),
});

/** A forum post. */
export type OsuForumPost = {
  id: number;
  topicId: number;
  forumId: number;
  userId: number | null;
  createdAt: string;
  editedAt: string | null;
  /** BBCode as written and osu!'s HTML; null when osu! hides it (a deleted post) or sends none. */
  body: { raw: string; html: string } | null;
};

/** A forum topic. */
export type OsuForumTopic = {
  id: number;
  forumId: number;
  title: string;
  userId: number | null;
  postCount: number;
  createdAt: string;
  firstPostId: number;
  lastPostId: number;
  isLocked: boolean;
  type: string;
};

/** A topic with one page of its posts; `cursor` fetches the next page, null on the last. */
export type OsuForumTopicPage = {
  topic: OsuForumTopic;
  posts: OsuForumPost[];
  cursor: string | null;
};

/** One page of topics; `cursor` fetches the next page, null on the last. */
export type OsuForumTopicList = { topics: OsuForumTopic[]; cursor: string | null };

const toPost = (post: z.infer<typeof osuForumPostSchema>): OsuForumPost => ({
  id: post.id,
  topicId: post.topic_id,
  forumId: post.forum_id,
  userId: post.user_id ?? null,
  createdAt: post.created_at,
  editedAt: post.edited_at ?? null,
  body: post.body ?? null,
});

const toTopic = (topic: z.infer<typeof osuForumTopicSchema>): OsuForumTopic => ({
  id: topic.id,
  forumId: topic.forum_id,
  title: topic.title,
  userId: topic.user_id ?? null,
  postCount: topic.post_count,
  createdAt: topic.created_at,
  firstPostId: topic.first_post_id,
  lastPostId: topic.last_post_id,
  isLocked: topic.is_locked,
  type: topic.type,
});

/**
 * @function toOsuForumTopicPage
 * @param raw {unknown} a GET /api/v2/forums/topics/{id} answer
 * @returns {OsuForumTopicPage} the topic, this page's posts, and the cursor for the next page
 * @throws {z.ZodError} when it isn't a topic page
 */
export const toOsuForumTopicPage = (raw: unknown): OsuForumTopicPage => {
  const page = osuForumTopicPageSchema.parse(raw);
  return {
    topic: toTopic(page.topic),
    posts: page.posts.map(toPost),
    cursor: page.cursor_string ?? null,
  };
};

/**
 * @function toOsuForumTopicList
 * @param raw {unknown} a GET /api/v2/forums/topics answer
 * @returns {OsuForumTopicList} the topics (no posts) and the cursor for the next page
 * @throws {z.ZodError} when it isn't a topic list
 */
export const toOsuForumTopicList = (raw: unknown): OsuForumTopicList => {
  const list = osuForumTopicListSchema.parse(raw);
  return { topics: list.topics.map(toTopic), cursor: list.cursor_string ?? null };
};

const HOSTS = new Set(["osu.ppy.sh", "old.ppy.sh"]);
const TOPIC_PATH = /^\/(?:community\/forums\/topics|forum\/t)\/(\d+)\/?$/;
const POST_PATH = /^\/(?:community\/forums\/posts|forum\/p)\/(\d+)\/?$/;

const positive = (text: string | null | undefined): number | null => {
  const value = Number(text);
  return text && Number.isSafeInteger(value) && value > 0 ? value : null;
};

/**
 * @function parseForumUrl
 * @param url {string} an osu! forum link (/community/forums/topics/1, ?start=post,
 *        /community/forums/posts/1, or the old /forum/t/1 and /forum/p/1)
 * @returns {{ topicId: number; postId: number | null } | { topicId: null; postId: number } | null}
 *          the topic and post it names, or null when it isn't an osu! forum link
 */
export const parseForumUrl = (
  url: string,
): { topicId: number; postId: number | null } | { topicId: null; postId: number } | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!HOSTS.has(parsed.hostname)) return null;
  const topic = parsed.pathname.match(TOPIC_PATH);
  if (topic) {
    const topicId = positive(topic[1]);
    return topicId ? { topicId, postId: positive(parsed.searchParams.get("start")) } : null;
  }
  const postId = positive(parsed.pathname.match(POST_PATH)?.[1]);
  return postId ? { topicId: null, postId } : null;
};
