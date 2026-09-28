/**
 * @file src/client/users.ts
 * @desc User lookups for createOsuClient: one user by id or username (GET /api/v2/users/{id} or
 *       /users/@{name}, a ruleset optional), and many by id (GET /api/v2/users?ids[]=, 50 a call).
 *       Answers map to OsuUser; a 404 is null, not an error.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

import { z } from "zod";
import { RULESETS } from "../shapes/beatmap.js";
import { type OsuUser, osuUserSchema, toOsuUser } from "../shapes/user.js";
import { OsuApiError } from "./errors.js";
import { release, type Transport } from "./http.js";
import { isId } from "./options.js";
import { fetchRows } from "./rows.js";
import type { AuthorizedInit } from "./token.js";
import type { UserLookup, UserOptions, UsersOptions } from "./types.js";

const usersResponseSchema = z.object({ users: z.array(z.unknown()) });
const alwaysCall = async (): Promise<boolean> => true;

/** What the user lookups need from the client. */
type UserDeps = {
  baseUrl: string;
  authorized: (url: string | URL, init?: AuthorizedInit) => Promise<Response>;
  transport: Transport;
};

/**
 * @function userPath
 * @param user {number | string} an id, or a username
 * @param ruleset {string | undefined} the ruleset whose stats to ask for
 * @returns {string} the path after /api/v2, with `key=id` so a number is never read as a name
 * @throws {RangeError} when an id isn't a positive integer, a name is blank, or the ruleset is
 *         unknown
 */
const userPath = (user: number | string, ruleset: string | undefined): string => {
  if (ruleset !== undefined && !(RULESETS as readonly string[]).includes(ruleset)) {
    throw new RangeError(`ruleset must be one of ${RULESETS.join(", ")}.`);
  }
  const mode = ruleset === undefined ? "" : `/${ruleset}`;
  if (typeof user === "number") {
    if (!isId(user)) throw new RangeError("A user id must be a positive integer.");
    return `/users/${user}${mode}?key=id`;
  }
  if (user.trim() === "") throw new RangeError("A username must not be blank.");
  return `/users/@${encodeURIComponent(user.trim())}${mode}`;
};

/**
 * @function createUserLookups
 * @param deps {UserDeps} the base URL, the token-carrying request, and the transport
 * @returns {{ getUser, getUsers }} the two lookups createOsuClient adds to the client
 */
export const createUserLookups = ({ baseUrl, authorized, transport }: UserDeps) => ({
  /**
   * @function getUser
   * @param user {number | string} an osu! id, or a username (osu! matches it without case; a
   *        name made of digits is still a name)
   * @param options {UserOptions} beforeCall, asked once before the call (your budget), and ruleset
   * @returns {Promise<OsuUser | null>} the user, or null when osu! has nobody by that id or name
   *          (404)
   * @throws {OsuApiError} code "budget" when beforeCall refuses; otherwise on a refused token,
   *         an error status (after the one 401 retry), a body without an id and username, a
   *         timeout, or a network failure
   * @throws {RangeError} when the id, name or ruleset isn't valid (before any call)
   */
  async getUser(
    user: number | string,
    { beforeCall = alwaysCall, ruleset }: UserOptions = {},
  ): Promise<OsuUser | null> {
    const path = userPath(user, ruleset);
    if (!(await beforeCall())) {
      throw new OsuApiError("budget", "beforeCall refused the osu! call.");
    }
    const response = await authorized(`${baseUrl}/api/v2${path}`);
    if (response.status === 404) {
      release(response);
      return null;
    }
    if (!response.ok) return transport.failFor(response, `osu! answered ${response.status}.`);
    const body = await transport.readJson(response);
    return toOsuUser(transport.readAs(osuUserSchema, body, response.status));
  },

  /**
   * @function getUsers
   * @param ids {readonly number[]} user ids (duplicates fine; anything but a positive integer is
   *        never sent and comes back missing)
   * @param options {UsersOptions} beforeCall, asked before each /users call (your budget)
   * @returns {Promise<UserLookup>} 50 ids per request. `found`: users by id. `missing`: invalid
   *          ids, and ids osu! answered no user for (deleted or restricted). `unchecked`: ids in
   *          batches beforeCall refused, and ids whose user failed the schema
   * @throws {OsuApiError} when the token request fails, a /users call answers an error status
   *         (after the one 401 retry) or a body that isn't `{ users: [...] }`, times out, or
   *         can't reach osu!; the whole call fails, earlier batches included
   */
  async getUsers(
    ids: readonly number[],
    { beforeCall = alwaysCall }: UsersOptions = {},
  ): Promise<UserLookup> {
    const unique = [...new Set(ids)];
    const found = new Map<number, OsuUser>();
    const unchecked = await fetchRows(unique.filter(isId), {
      beforeCall,
      fetchBatch: async (batch) => {
        const url = new URL(`${baseUrl}/api/v2/users`);
        for (const id of batch) url.searchParams.append("ids[]", String(id));
        const response = await authorized(url);
        if (!response.ok) return transport.failFor(response, `osu! answered ${response.status}.`);
        const body = await transport.readJson(response);
        return transport.readAs(usersResponseSchema, body, response.status).users;
      },
      schema: osuUserSchema,
      accept: (row) => found.set(row.id, toOsuUser(row)),
    });
    const skipped = new Set(unchecked);
    const missing = unique.filter((id) => !found.has(id) && !skipped.has(id));
    return { found, missing, unchecked };
  },
});
