/**
 * @file scripts/check-consumer.mjs
 * @desc Installs the packed package with a given zod version into a throwaway project, then
 *       typechecks a consumer strictly (no skipLibCheck, so broken .d.ts can't hide as `any`) and
 *       runs it. Proves the zod peer range's floor. Usage: node scripts/check-consumer.mjs <zod
 *       version> (after `bun run build`). Needs the npm registry.
 * @author David @dvhsh (https://dvh.sh)
 * @created Wed Sep 23, 2026
 * @modified Wed Sep 23, 2026
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const zod = process.argv[2];
if (!zod) throw new Error("usage: node scripts/check-consumer.mjs <zod version>");
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const dir = mkdtempSync(path.join(tmpdir(), "osu-consumer-"));
const run = (command, args, cwd = dir) =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

try {
  const tarball = run("npm", ["pack", "--silent", "--pack-destination", dir], root).trim();
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module", private: true }));
  run("npm", [
    "install",
    "--silent",
    "--no-audit",
    "--no-fund",
    path.join(dir, tarball),
    `zod@${zod}`,
  ]);
  writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        exactOptionalPropertyTypes: true,
        noEmit: true,
        skipLibCheck: false,
        module: "nodenext",
        moduleResolution: "nodenext",
        target: "ES2023",
        lib: ["ES2023", "DOM"],
        types: [],
      },
      files: ["consumer.ts"],
    }),
  );
  writeFileSync(
    path.join(dir, "consumer.ts"),
    `import { z } from "zod";
import { createOsuClient, OsuApiError, type OsuApiErrorCode, type OsuClient } from "@haruhimemoe/osu";
import { type BeatmapMeta, beatmapMetaSchema, isExtendedBeatmapset, osuBeatmapsetSchema, type Ruleset, toBeatmapMeta, osuBeatmapRowSchema, toOsuUser } from "@haruhimemoe/osu/shapes";

const row = { id: 75, beatmapset_id: 1, mode: "osu", version: "Normal", difficulty_rating: 2.55, cs: 4, ar: 6, accuracy: 6, drain: 6, bpm: 120, total_length: 142, checksum: null, beatmapset: { artist: "a", title: "t", creator: "c", user_id: 2 } };
const meta: BeatmapMeta = toBeatmapMeta(osuBeatmapRowSchema.parse(row));
const inferred: z.infer<typeof beatmapMetaSchema> = meta;
// @ts-expect-error an unknown ruleset must not typecheck (it would if types were any)
const bad: Ruleset = "catch";
const set = osuBeatmapsetSchema.parse({ id: 1, status: "ranked", artist: "a", title: "t", tags: "", track_id: null, availability: { download_disabled: false, more_information: null } });
if (!isExtendedBeatmapset(set)) throw new Error("extended set not recognized");
if (toOsuUser({ id: 2, username: "peppy" }).osuId !== 2) throw new Error("user");
const client: OsuClient = createOsuClient({ userAgent: "consumer-check", credentials: { clientId: "1", clientSecret: "s" } });
const code: OsuApiErrorCode = new OsuApiError("http_error", "x", { status: 429, retryAfterMs: 1000 }).code;
void client; void inferred; void bad; void code;
console.log("consumer: ok");
`,
  );
  run(path.join(root, "node_modules", ".bin", "tsc"), ["-p", dir]);
  run(process.execPath, ["--experimental-strip-types", "--no-warnings", "consumer.ts"]);
  console.log(`zod ${zod}: ok`);
} catch (error) {
  console.error(`zod ${zod}: FAILED\n${error.stdout ?? ""}${error.stderr ?? error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
