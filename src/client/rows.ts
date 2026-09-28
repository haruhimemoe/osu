/**
 * @file src/client/rows.ts
 * @desc Id batches (GET /api/v2/beatmaps, or /users): asks the caller's budget before each batch,
 *       and files each answered row as accepted or unchecked. getBeatmaps, getBeatmapsets and
 *       getUsers share it.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Mon Sep 28, 2026
 */

import { z } from "zod";
import { OSU_BEATMAPS_BATCH_LIMIT } from "./options.js";

/** Just the id of a /beatmaps row, to file a row that fails the full schema. */
const rowIdSchema = z.object({ id: z.number() });

/** How fetchRows asks for, checks and keeps rows. */
export type RowFetch<T extends { id: number }> = {
  /** The caller's budget, asked before each batch; false skips it. */
  beforeCall: () => Promise<boolean>;
  /** One /beatmaps (or /users) call for up to OSU_BEATMAPS_BATCH_LIMIT ids, returning its raw rows. */
  fetchBatch: (ids: readonly number[]) => Promise<unknown[]>;
  /** The schema a row must pass. */
  schema: z.ZodType<T>;
  /** Gets each row that parses and was asked for. */
  accept: (row: T) => void;
};

/**
 * Files one batch's rows: `accept` gets each row that parses and was asked for. The ids of rows
 * that fail the schema are returned, and so is every id the batch has no good row for when some
 * row's id can't even be read (we can't tell which id it was).
 */
const fileRows = <T extends { id: number }>(
  rows: readonly unknown[],
  batch: readonly number[],
  { schema, accept }: Pick<RowFetch<T>, "schema" | "accept">,
): number[] => {
  const asked = new Set(batch);
  const good = new Set<number>();
  const bad = new Set<number>();
  let unreadable = false;
  for (const row of rows) {
    const parsed = schema.safeParse(row);
    if (parsed.success) {
      if (!asked.has(parsed.data.id)) continue;
      good.add(parsed.data.id);
      accept(parsed.data);
      continue;
    }
    const id = rowIdSchema.safeParse(row);
    if (!id.success) unreadable = true;
    else if (asked.has(id.data.id)) bad.add(id.data.id);
  }
  return batch.filter((id) => !good.has(id) && (unreadable || bad.has(id)));
};

/**
 * @function fetchRows
 * @param ids {readonly number[]} unique positive ids, sent OSU_BEATMAPS_BATCH_LIMIT at a time
 * @param how {RowFetch<T>} beforeCall, fetchBatch, the row schema, and accept
 * @returns {Promise<number[]>} the unchecked ids: every id of a batch beforeCall refused, and the
 *          ids fileRows couldn't file
 * @throws {OsuApiError} whatever fetchBatch throws; the whole call fails
 */
export const fetchRows = async <T extends { id: number }>(
  ids: readonly number[],
  how: RowFetch<T>,
): Promise<number[]> => {
  const unchecked: number[] = [];
  for (let i = 0; i < ids.length; i += OSU_BEATMAPS_BATCH_LIMIT) {
    const batch = ids.slice(i, i + OSU_BEATMAPS_BATCH_LIMIT);
    if (!(await how.beforeCall())) {
      unchecked.push(...batch);
      continue;
    }
    unchecked.push(...fileRows(await how.fetchBatch(batch), batch, how));
  }
  return unchecked;
};
