/**
 * Minimal declaration for `import.meta.glob`.
 *
 * It is Vite's, resolved at transform time, and the fixture loader uses it so
 * that dropping in a directory is all it takes to add a case. Vitest handles it
 * at runtime; `tsc` does not know about it, and this project's tsconfig now
 * includes `tests/` (it was narrowed so `src/` could import `@core/*`), so the
 * whole typecheck failed on three lines in the loader.
 *
 * Declared here rather than via `"types": ["vite/client"]` for two reasons:
 * pnpm's layout does not expose `vite/client.d.ts` at a path tsc resolves, and
 * adding a `types` array would switch off automatic @types inclusion for the
 * entire program — a large side effect for one helper.
 */

interface ImportMeta {
  glob<T = unknown>(
    pattern: string,
    options?: { eager?: boolean; import?: string }
  ): Record<string, T>;
}
