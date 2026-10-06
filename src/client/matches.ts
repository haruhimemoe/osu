/**
 * @file src/client/matches.ts
 * @desc The match lookup for createOsuClient: one multiplayer match by id or mp link
 *       (GET /api/v2/matches/{id}), paging back through its events with `before` until the first
 *       one, so a long match comes back whole. A 404 is null, not an error.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Oct 6, 2026
 * @modified Tue Oct 6, 2026
 */

import {
  type MatchEvent,
  type OsuMatch,
  osuMatchResponseSchema,
  parseMatchId,
  toOsuMatch,
} from "../shapes/match.js";
import type { OsuUser } from "../shapes/user.js";
import { OsuApiError } from "./errors.js";
import { release, type Transport } from "./http.js";
import { OSU_MATCH_EVENTS_LIMIT, OSU_MATCH_PAGE_LIMIT } from "./options.js";
import type { AuthorizedInit } from "./token.js";
import type { MatchLookup, MatchOptions } from "./types.js";

const alwaysCall = async (): Promise<boolean> => true;

/** What the match lookup needs from the client. */
type MatchDeps = {
  baseUrl: string;
  authorized: (url: string | URL, init?: AuthorizedInit) => Promise<Response>;
  transport: Transport;
};

/**
 * @function createMatchLookups
 * @param deps {MatchDeps} the base URL, the token-carrying request, and the transport
 * @returns {{ getMatch }} the lookup createOsuClient adds to the client
 */
export const createMatchLookups = ({ baseUrl, authorized, transport }: MatchDeps) => {
  /** One page; null on a 404. */
  const fetchPage = async (id: number, before: number | null): Promise<OsuMatch | null> => {
    const url = new URL(`${baseUrl}/api/v2/matches/${id}`);
    if (before !== null) url.searchParams.set("before", String(before));
    url.searchParams.set("limit", String(OSU_MATCH_EVENTS_LIMIT));
    const response = await authorized(url);
    if (response.status === 404) {
      release(response);
      return null;
    }
    if (!response.ok) return transport.failFor(response, `osu! answered ${response.status}.`);
    const body = await transport.readJson(response);
    return toOsuMatch(transport.readAs(osuMatchResponseSchema, body, response.status));
  };

  return {
    /**
     * @function getMatch
     * @param match {number | string} a match id, or an mp link
     *        (`https://osu.ppy.sh/community/matches/{id}` or `https://osu.ppy.sh/mp/{id}`)
     * @param options {MatchOptions} beforeCall, asked before each page (your budget), and
     *        maxPages, the most pages one call reads
     * @returns {Promise<MatchLookup | null>} the match with every event osu! had, oldest first,
     *          and `complete: true`; `complete: false` when maxPages ran out or beforeCall refused
     *          a later page, with the newest events read so far. null when osu! has no such match
     * @throws {OsuApiError} code "budget" when beforeCall refuses the first page; otherwise on a
     *         refused token, an error status (after the one 401 retry; a 404 after the first page
     *         included), a body that isn't a match, a timeout, or a network failure
     * @throws {RangeError} when match isn't an id or mp link, or maxPages isn't a positive integer
     *         (before any call)
     */
    async getMatch(
      match: number | string,
      { beforeCall = alwaysCall, maxPages = OSU_MATCH_PAGE_LIMIT }: MatchOptions = {},
    ): Promise<MatchLookup | null> {
      const id = parseMatchId(match);
      if (id === null) throw new RangeError("match must be a match id or an osu! mp link.");
      if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
        throw new RangeError("maxPages must be a positive integer.");
      }
      if (!(await beforeCall())) {
        throw new OsuApiError("budget", "beforeCall refused the osu! call.");
      }
      const first = await fetchPage(id, null);
      if (first === null) return null;
      const events = new Map<number, MatchEvent>();
      const users = new Map<number, OsuUser>();
      const keep = (page: OsuMatch): void => {
        for (const event of page.events) events.set(event.id, event);
        for (const user of page.users) users.set(user.osuId, user);
      };
      keep(first);
      let oldest = first.events[0]?.id ?? null;
      let pages = 1;
      let complete = true;
      // An empty match (no events, first_event_id 0) or a page reaching the first event is whole.
      while (oldest !== null && oldest > first.firstEventId) {
        if (pages >= maxPages || !(await beforeCall())) {
          complete = false;
          break;
        }
        pages += 1;
        const page = await fetchPage(id, oldest);
        if (page === null) {
          throw new OsuApiError("http_error", "osu! answered 404 partway through the match.", {
            status: 404,
          });
        }
        const before = oldest;
        keep(page);
        oldest = page.events[0]?.id ?? null;
        // A page with nothing older means osu! has no more to give, whatever first_event_id says.
        if (oldest === null || oldest >= before) break;
      }
      return {
        match: {
          ...first,
          events: [...events.values()].sort((a, b) => a.id - b.id),
          users: [...users.values()],
        },
        complete,
      };
    },
  };
};
