/**
 * @file src/format/index.ts
 * @desc @haruhimemoe/osu/format: display text for beatmap numbers (length, CS/AR/OD/HP, BPM,
 *       star rating), file sizes, long durations and ranges, and (0.6) score mods and accuracy. Pure functions with no imports, so
 *       it's safe in browsers and loads no zod. Moved here from packs and pools, which had the
 *       same copy; the output is unchanged.
 * @author David @dvhsh (https://dvh.sh)
 * @created Mon Sep 28, 2026
 * @modified Tue Oct 6, 2026
 */

/**
 * @function formatDuration
 * @param seconds {number} length in seconds (rounded to the nearest second)
 * @returns {string} "m:ss", minutes uncapped ("60:00" for an hour)
 */
export const formatDuration = (seconds: number): string => {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * @function formatStat
 * @param value {number} CS/AR/OD/HP
 * @returns {string} at most one decimal, float noise removed ("3.8", "9")
 */
export const formatStat = (value: number): string => String(Math.round(value * 10) / 10);

/**
 * @function formatBpm
 * @param bpm {number} beats per minute
 * @returns {string} a whole number ("222")
 */
export const formatBpm = (bpm: number): string => String(Math.round(bpm));

/**
 * @function formatStars
 * @param stars {number} star rating
 * @returns {string} two decimals ("7.81", "5.00")
 */
export const formatStars = (stars: number): string => stars.toFixed(2);

/**
 * @function formatBytes
 * @param bytes {number} size in bytes
 * @returns {string} "512 B", "2.0 KB", "6.6 MB", "15 GB" (1024-based; one decimal under 10; GB is
 *          the largest unit)
 */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
};

/**
 * @function formatLongDuration
 * @param seconds {number} length in seconds (rounded to the nearest second)
 * @returns {string} "m:ss" under an hour, "h:mm:ss" from an hour up
 */
export const formatLongDuration = (seconds: number): string => {
  const total = Math.round(seconds);
  if (total < 3600) return formatDuration(total);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * @function formatRange
 * @param low {number} bottom of the range
 * @param high {number} top of the range
 * @param format {(n: number) => string} how to show one end, e.g. formatStars
 * @returns {string} "low–high" (an en dash), or one value when both ends look the same
 */
export const formatRange = (low: number, high: number, format: (n: number) => string): string => {
  const [from, to] = [format(low), format(high)];
  return from === to ? from : `${from}–${to}`;
};

/**
 * @function formatMods
 * @param mods {readonly { acronym: string; settings?: Record<string, unknown> }[]} a score's mods
 * @returns {string} "+HDDT", or "NM" with no mods. A changed rate shows after its mod: "+DT(1.3x)"
 */
export const formatMods = (
  mods: readonly { acronym: string; settings?: Record<string, unknown> | undefined }[],
): string => {
  if (mods.length === 0) return "NM";
  const parts = mods.map(({ acronym, settings }) => {
    const rate = settings?.speed_change;
    return typeof rate === "number" ? `${acronym}(${rate}x)` : acronym;
  });
  return `+${parts.join("")}`;
};

/**
 * @function formatAccuracy
 * @param accuracy {number} 0 to 1, as a score carries it
 * @returns {string} two decimals and a percent sign ("98.76%")
 */
export const formatAccuracy = (accuracy: number): string => `${(accuracy * 100).toFixed(2)}%`;
