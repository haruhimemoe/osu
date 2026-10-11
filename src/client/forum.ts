/**
 * @file src/client/forum.ts
 * @desc Forum reads for createOsuClient: a topic page (GET /api/v2/forums/topics/{id}), one post
 *       by topic and post id, and a topic list (GET /api/v2/forums/topics). Posts carry raw BBCode.
 * @author David @dvhsh (https://dvh.sh)
 * @created Sun Oct 11, 2026
 * @modified Sun Oct 11, 2026
 */

import {
  type OsuForumPost,
  type OsuForumTopicList,
  type OsuForumTopicPage,
  osuForumTopicListSchema,
  osuForumTopicPageSchema,
  toOsuForumTopicList,
  toOsuForumTopicPage,
} from "../shapes/forum.js";
import { OsuApiError } from "./errors.js";
import { release, type Transport } from "./http.js";
import { isId } from "./options.js";
import type { AuthorizedInit } from "./token.js";
import type { BeatmapOptions, ForumTopicOptions, ListForumTopicsOptions } from "./types.js";

/** Most posts or topics osu! returns in one page. */
export const OSU_FORUM_PAGE_LIMIT = 50;

type ForumDeps = {
  baseUrl: string;
  authorized: (url: string | URL, init?: AuthorizedInit) => Promise<Response>;
  transport: Transport;
};

const alwaysCall = async (): Promise<boolean> => true;

const checkLimit = (limit: number | undefined): void => {
  if (limit === undefined) return;
  if (!Number.isInteger(limit) || limit < 1 || limit > OSU_FORUM_PAGE_LIMIT) {
    throw new RangeError(`limit must be an integer from 1 to ${OSU_FORUM_PAGE_LIMIT}.`);
  }
};

/**
 * @function createForumLookups
 * @param deps {ForumDeps} the base URL, the token-carrying request, and the transport
 * @returns {{ getForumTopic, getForumPost, listForumTopics }} the lookups createOsuClient adds
 */
export const createForumLookups = ({ baseUrl, authorized, transport }: ForumDeps) => {
  /** One GET after the budget; the response, or a thrown OsuApiError on a refused budget. */
  const send = async (url: URL, beforeCall: () => Promise<boolean>): Promise<Response> => {
    if (!(await beforeCall())) {
      throw new OsuApiError("budget", "beforeCall refused the osu! call.");
    }
    return authorized(url, { beforeRetry: beforeCall });
  };

  /**
   * @function getForumTopic
   * @param topicId {number} the topic's id
   * @param options {ForumTopicOptions} beforeCall (your budget), sort, limit (1 to 50), cursor
   *        from the previous page, and start (a post id to begin at)
   * @returns {Promise<OsuForumTopicPage | null>} the topic and a page of its posts, or null when
   *          osu! has no such topic (404)
   * @throws {OsuApiError} code "budget" when beforeCall refuses; otherwise on a refused token, an
   *         error status (after retries), a body that isn't a topic page, a timeout, or a network
   *         failure
   * @throws {RangeError} when topicId, limit or start isn't valid (before any call)
   */
  const getForumTopic = async (
    topicId: number,
    { beforeCall = alwaysCall, sort, limit, cursor, start }: ForumTopicOptions = {},
  ): Promise<OsuForumTopicPage | null> => {
    if (!isId(topicId)) throw new RangeError("topicId must be a positive integer.");
    if (start !== undefined && !isId(start)) {
      throw new RangeError("start must be a positive integer.");
    }
    checkLimit(limit);
    const url = new URL(`${baseUrl}/api/v2/forums/topics/${topicId}`);
    if (sort) url.searchParams.set("sort", sort);
    if (start !== undefined) url.searchParams.set("start", String(start));
    if (limit !== undefined) url.searchParams.set("limit", String(limit));
    if (cursor) url.searchParams.set("cursor_string", cursor);
    const response = await send(url, beforeCall);
    if (response.status === 404) {
      release(response);
      return null;
    }
    if (!response.ok) return transport.failFor(response, `osu! answered ${response.status}.`);
    const body = await transport.readJson(response);
    return toOsuForumTopicPage(transport.readAs(osuForumTopicPageSchema, body, response.status));
  };

  return {
    getForumTopic,

    /**
     * @function getForumPost
     * @param ref {{ topicId: number; postId: number }} the topic and the post in it (osu! has no
     *        lookup by post id alone; parseForumUrl reads both from a link when it has them)
     * @param options {BeatmapOptions} beforeCall (your budget), asked before the one call
     * @returns {Promise<OsuForumPost | null>} the post, or null when the topic is gone or doesn't
     *          hold that post
     * @throws {OsuApiError} as getForumTopic
     * @throws {RangeError} when topicId or postId isn't a positive integer (before any call)
     */
    async getForumPost(
      { topicId, postId }: { topicId: number; postId: number },
      options: BeatmapOptions = {},
    ): Promise<OsuForumPost | null> {
      if (!isId(postId)) throw new RangeError("postId must be a positive integer.");
      const page = await getForumTopic(topicId, {
        ...options,
        sort: "id_asc",
        start: postId,
        limit: 1,
      });
      // start seeks to the first post at or after postId: only an exact match is this post.
      const post = page?.posts[0];
      return post?.id === postId ? post : null;
    },

    /**
     * @function listForumTopics
     * @param options {ListForumTopicsOptions} beforeCall (your budget), forumId, sort, limit
     *        (1 to 50), and cursor from the previous page
     * @returns {Promise<OsuForumTopicList>} topics without posts, and the next page's cursor
     * @throws {OsuApiError} code "budget" when beforeCall refuses; otherwise on a refused token, an
     *         error status (after retries), a body that isn't a topic list, a timeout, or a network
     *         failure
     * @throws {RangeError} when forumId or limit isn't valid (before any call)
     */
    async listForumTopics({
      beforeCall = alwaysCall,
      forumId,
      sort,
      limit,
      cursor,
    }: ListForumTopicsOptions = {}): Promise<OsuForumTopicList> {
      if (forumId !== undefined && !isId(forumId)) {
        throw new RangeError("forumId must be a positive integer.");
      }
      checkLimit(limit);
      const url = new URL(`${baseUrl}/api/v2/forums/topics`);
      if (forumId !== undefined) url.searchParams.set("forum_id", String(forumId));
      if (sort) url.searchParams.set("sort", sort);
      if (limit !== undefined) url.searchParams.set("limit", String(limit));
      if (cursor) url.searchParams.set("cursor_string", cursor);
      const response = await send(url, beforeCall);
      if (!response.ok) return transport.failFor(response, `osu! answered ${response.status}.`);
      const body = await transport.readJson(response);
      return toOsuForumTopicList(transport.readAs(osuForumTopicListSchema, body, response.status));
    },
  };
};
