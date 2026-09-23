/**
 * Fixture discovery.
 *
 * Every directory under `fixtures/` that contains a `case.ts`, a
 * `response.json` and a `meta.json` is a fixture. Nothing has to be
 * registered: dropping a directory in is enough, which is the point — the
 * documented path to live measurement (tests/ocr/README.md) is "record one
 * response, drop it in a directory", and a registry file would be one more
 * step to forget.
 *
 * `import.meta.glob` is Vite's, resolved at transform time, so this stays
 * dependency-free and works under `vitest run` with no config.
 */

import type { CaseMeta, LoadedCase, OcrCase, RecordedResponse } from "./types.ts";

const caseMods = import.meta.glob("./fixtures/*/case.ts", { eager: true }) as Record<
  string,
  { CASE?: OcrCase }
>;
const responseMods = import.meta.glob("./fixtures/*/response.json", {
  eager: true,
  import: "default",
}) as Record<string, RecordedResponse>;
const metaMods = import.meta.glob("./fixtures/*/meta.json", {
  eager: true,
  import: "default",
}) as Record<string, CaseMeta>;

function dirOf(path: string): string {
  const m = path.match(/^\.\/fixtures\/([^/]+)\//);
  if (!m) throw new Error(`unexpected fixture path: ${path}`);
  return m[1];
}

function index<T>(mods: Record<string, T>): Map<string, T> {
  return new Map(Object.entries(mods).map(([p, v]) => [dirOf(p), v]));
}

/**
 * Load every fixture, sorted by id so the report is stable between runs.
 *
 * Throws on a malformed fixture rather than skipping it. A silently skipped
 * fixture is an accuracy number that quietly stops covering a case — the exact
 * failure mode this harness exists to prevent.
 */
export function loadCases(): LoadedCase[] {
  const specs = index(caseMods);
  const responses = index(responseMods);
  const metas = index(metaMods);

  const dirs = [...new Set([...specs.keys(), ...responses.keys(), ...metas.keys()])].sort();
  if (dirs.length === 0) {
    throw new Error("no fixtures found under tests/ocr/fixtures/");
  }

  return dirs.map((dir) => {
    const mod = specs.get(dir);
    const response = responses.get(dir);
    const meta = metas.get(dir);

    if (!mod) throw new Error(`fixture ${dir}: missing case.ts`);
    if (!mod.CASE) throw new Error(`fixture ${dir}: case.ts must export const CASE`);
    if (!response) throw new Error(`fixture ${dir}: missing response.json`);
    if (!meta) throw new Error(`fixture ${dir}: missing meta.json`);

    const spec = mod.CASE;
    if (spec.id !== dir) {
      throw new Error(`fixture ${dir}: CASE.id is "${spec.id}", must equal the directory name`);
    }
    if (!spec.probe?.trim()) throw new Error(`fixture ${dir}: CASE.probe is required`);
    if (!spec.why?.trim()) throw new Error(`fixture ${dir}: CASE.why is required`);
    if (meta.source !== "synthetic" && meta.source !== "recorded") {
      throw new Error(`fixture ${dir}: meta.source must be "synthetic" or "recorded"`);
    }

    return { dir, spec, response, meta };
  });
}
