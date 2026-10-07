/**
 * @file src/client/client.ts
 * @desc createOsuClient: the osu! API v2 client for servers (client credentials, scope public):
 *       beatmap metadata, beatmapsets with their content fields (with a capped /beatmapsets/{id}
 *       fallback for compact ones), star ratings with mods, users (src/client/users.ts), scores and profiles (src/client/scores.ts) and multiplayer matches (src/client/matches.ts). Every request sends your
 *       User-Agent and gives up after timeoutMs. Every failure talking to osu! is an OsuApiError.
 *       Keep the client secret on the server.
 * @author David @dvhsh (https://dvh.sh)
 * @created Tue Sep 22, 2026
 * @modified Tue Oct 6, 2026
 */

import { z } from "zod";
import { type BeatmapMeta, osuBeatmapRowSchema, toBeatmapMeta } from "../shapes/beatmap.js";
import {
  isExtendedBeatmapset,
  type OsuBeatmapset,
  type OsuBeatmapsetExtended,
  osuBeatmapsetRowSchema,
  osuBeatmapsetSchema,
} from "../shapes/beatmapset.js";
import { OsuApiError } from "./errors.js";
import { createTransport, release } from "./http.js";
import { createMatchLookups } from "./matches.js";
import { isId, OSU_BEATMAPSET_FALLBACK_LIMIT, resolveOptions } from "./options.js";
import { fetchRows } from "./rows.js";
import { createScoreLookups } from "./scores.js";
import { createAuthorizer } from "./token.js";
import type {
  BeatmapLookup,
  BeatmapOptions,
  BeatmapsetLookup,
  BeatmapsetOptions,
  OsuClientOptions,
  StarRatingOptions,
} from "./types.js";
import { createUserLookups } from "./users.js";

const beatmapsResponseSchema = z.object({ beatmaps: z.array(z.unknown()) });
const attributesResponseSchema = z.object({
  attributes: z.object({ star_rating: z.number().nonnegative() }),
});
const alwaysCall = async (): Promise<boolean> => true;

/**
 * @function createOsuClient
 * @param options {OsuClientOptions} credentials, User-Agent, and optional base URL, timeout,
 *        fetch and clock
 * @returns {{ getBeatmaps, getBeatmapsets, getStarRating, getBeatmap, getUser, getUsers,
 *          getUserProfile, getUserScores, getBeatmapUserScores, getBeatmapScores, getMatch }}
 *          the client;
 *          create one per process and reuse it so the token is shared
 * @throws {TypeError} when userAgent is blank or holds anything but printable ASCII, or
 *         credentials given as an object aren't two non-empty strings
 * @throws {RangeError} when timeoutMs isn't an integer from 1 to 2_147_483_647, or baseUrl isn't
 *         an https URL (or http on localhost / 127.0.0.1)
 */
export const createOsuClient = (options: OsuClientOptions) => {
  const settings = resolveOptions(options);
  const { baseUrl } = settings;
  const transport = createTransport(settings);
  const authorized = createAuthorizer(settings, transport);

  const getJson = async (url: URL): Promise<{ body: unknown; status: number }> => {
    const response = await authorized(url);
    if (!response.ok) return transport.failFor(response, `osu! answered ${response.status}.`);
    return { body: await transport.readJson(response), status: response.status };
  };

  const fetchBatch = async (ids: readonly number[]): Promise<unknown[]> => {
    const url = new URL(`${baseUrl}/api/v2/beatmaps`);
    for (const id of ids) url.searchParams.append("ids[]", String(id));
    const { body, status } = await getJson(url);
    return transport.readAs(beatmapsResponseSchema, body, status).beatmaps;
  };

  /**
   * The full set, for a /beatmaps row whose beatmapset was compact: the extended set, "missing"
   * when osu! answers 404, or "unchecked" on anything else (429, 5xx, a body we can't read, a
   * set that's still compact), so one bad lookup never throws away what the call already has.
   */
  const fetchBeatmapset = async (
    setId: number,
  ): Promise<OsuBeatmapsetExtended | "missing" | "unchecked"> => {
    try {
      const { body } = await getJson(new URL(`${baseUrl}/api/v2/beatmapsets/${setId}`));
      const parsed = osuBeatmapsetSchema.safeParse(body);
      return parsed.success && isExtendedBeatmapset(parsed.data) ? parsed.data : "unchecked";
    } catch (error) {
      // Only osu!'s own failures are "unchecked"; a credentials problem is the caller's to see.
      if (!(error instanceof OsuApiError)) throw error;
      return error.status === 404 ? "missing" : "unchecked";
    }
  };

  /**
   * Swaps each compact set in `sets` for the extended one from /beatmapsets/{id}, in place: one
   * call per compact set (osu!'s docs say /beatmaps sends extended sets), capped at `limit` so a
   * bad /beatmaps answer can't spend the rate limit. The cap is checked first, so beforeCall is
   * only asked about calls that would really be made. A set osu! answers 404 for is deleted.
   * Returns the ids of the sets left compact.
   */
  const completeSets = async (
    sets: Map<number, OsuBeatmapset>,
    limit: number,
    beforeCall: () => Promise<boolean>,
  ): Promise<Set<number>> => {
    let fallbacks = 0;
    const skipped = new Set<number>();
    for (const [setId, set] of sets) {
      if (isExtendedBeatmapset(set)) continue;
      if (fallbacks >= limit || !(await beforeCall())) {
        skipped.add(setId);
        continue;
      }
      fallbacks += 1;
      const full = await fetchBeatmapset(setId);
      if (full === "missing") sets.delete(setId);
      else if (full === "unchecked") skipped.add(setId);
      else sets.set(setId, full);
    }
    return skipped;
  };

  return {
    ...createUserLookups({ baseUrl, authorized, transport }),
    ...createMatchLookups({ baseUrl, authorized, transport }),
    ...createScoreLookups({ baseUrl, authorized, transport }),

    /**
     * @function getBeatmaps
     * @param ids {readonly number[]} difficulty ids (duplicates fine; anything but a positive
     *        integer is never sent and comes back missing)
     * @param options {BeatmapOptions} beforeCall, asked before each /beatmaps call (your budget)
     * @returns {Promise<BeatmapLookup>} 50 ids per request. `found`: metadata by id. `missing`:
     *          invalid ids, and ids osu! answered no row for. `unchecked`: ids in batches
     *          beforeCall refused, ids whose row failed the schema, and every unanswered id of a
     *          batch holding a row without a readable id
     * @throws {OsuApiError} when the token request fails, a /beatmaps call answers an error
     *         status (after the one 401 retry) or a body that isn't `{ beatmaps: [...] }`, times
     *         out, or can't reach osu!; the whole call fails, earlier batches included
     * @throws {TypeError} when the credentials aren't two non-empty strings
     */
    async getBeatmaps(
      ids: readonly number[],
      { beforeCall = alwaysCall }: BeatmapOptions = {},
    ): Promise<BeatmapLookup> {
      const unique = [...new Set(ids)];
      const found = new Map<number, BeatmapMeta>();
      const unchecked = await fetchRows(unique.filter(isId), {
        beforeCall,
        fetchBatch,
        schema: osuBeatmapRowSchema,
        accept: (row) => found.set(row.id, toBeatmapMeta(row)),
      });
      const skipped = new Set(unchecked);
      const missing = unique.filter((id) => !found.has(id) && !skipped.has(id));
      return { found, missing, unchecked };
    },

    /**
     * @function getBeatmapsets
     * @param ids {readonly number[]} difficulty ids (duplicates fine; anything but a positive
     *        integer is never sent and is left out)
     * @param options {BeatmapsetOptions} beforeCall (your rate budget) and the fallback cap
     * @returns {Promise<BeatmapsetLookup>} each known id's extended beatmapset, and as unchecked:
     *          ids in /beatmaps batches beforeCall refused; ids whose row failed the schema (every
     *          unanswered id of the batch when a row's id can't be read); and ids whose set came
     *          compact and wasn't looked up (fallbackLimit spent, or beforeCall refused) or whose
     *          /beatmapsets/{id} lookup failed in any way but a 404 (error status, token failure,
     *          timeout, network, unreadable or still-compact body). A 404 means the set is gone
     *          (even one from a token request made during the lookup): its ids are in neither,
     *          like ids osu! answered no row for
     * @throws {OsuApiError} when the token request before a /beatmaps call fails, or a /beatmaps
     *         call answers an error status (after the one 401 retry) or a body that isn't
     *         `{ beatmaps: [...] }`, times out, or can't reach osu!; the whole call fails
     * @throws {TypeError} when the credentials aren't two non-empty strings
     * @throws {RangeError} when fallbackLimit isn't a non-negative integer (before any call)
     */
    async getBeatmapsets(
      ids: readonly number[],
      {
        beforeCall = alwaysCall,
        fallbackLimit = OSU_BEATMAPSET_FALLBACK_LIMIT,
      }: BeatmapsetOptions = {},
    ): Promise<BeatmapsetLookup> {
      if (!Number.isInteger(fallbackLimit) || fallbackLimit < 0) {
        throw new RangeError("fallbackLimit must be a non-negative integer.");
      }
      const setOf = new Map<number, number>();
      const sets = new Map<number, OsuBeatmapset>();
      const unchecked = await fetchRows([...new Set(ids)].filter(isId), {
        beforeCall,
        fetchBatch,
        schema: osuBeatmapsetRowSchema,
        accept: (row) => {
          setOf.set(row.id, row.beatmapset_id);
          if (!sets.has(row.beatmapset_id)) sets.set(row.beatmapset_id, row.beatmapset);
        },
      });
      const skipped = await completeSets(sets, fallbackLimit, beforeCall);
      const found = new Map<number, OsuBeatmapsetExtended>();
      for (const [id, setId] of setOf) {
        const set = sets.get(setId);
        if (set && isExtendedBeatmapset(set)) found.set(id, set);
        else if (skipped.has(setId)) unchecked.push(id);
      }
      return { sets: found, unchecked };
    },

    /**
     * @function getStarRating
     * @param beatmapId {number} difficulty id
     * @param mods {readonly string[]} mod acronyms, e.g. ["HD", "HR"] (no-mod ratings come with
     *        the metadata)
     * @param options {StarRatingOptions} beforeCall, asked once before the call (your budget)
     * @returns {Promise<number | null>} osu!'s current star rating with those mods, or null when
     *          osu! has no such map or won't rate those mods (404/422)
     * @throws {OsuApiError} code "budget" when beforeCall refuses; otherwise on a refused token,
     *         a rate limit, a server error, an unreadable body, a timeout, or a network failure
     * @throws {TypeError} when the credentials aren't two non-empty strings
     * @throws {RangeError} when beatmapId isn't a positive integer
     */
    async getStarRating(
      beatmapId: number,
      mods: readonly string[],
      { beforeCall = alwaysCall }: StarRatingOptions = {},
    ): Promise<number | null> {
      if (!isId(beatmapId)) throw new RangeError("beatmapId must be a positive integer.");
      if (!(await beforeCall())) {
        throw new OsuApiError("budget", "beforeCall refused the osu! call.");
      }
      const response = await authorized(`${baseUrl}/api/v2/beatmaps/${beatmapId}/attributes`, {
        method: "POST",
        body: JSON.stringify({ mods }),
        headers: { "Content-Type": "application/json" },
      });
      if (response.status === 404 || response.status === 422) {
        release(response);
        return null;
      }
      if (!response.ok) return transport.failFor(response, `osu! answered ${response.status}.`);
      const body = await transport.readJson(response);
      return transport.readAs(attributesResponseSchema, body, response.status).attributes
        .star_rating;
    },
  };
};

/** The client createOsuClient returns. */
export type OsuClient = ReturnType<typeof createOsuClient>;
