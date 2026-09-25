import { readFile } from 'node:fs/promises';
import type { GalleryEntry } from './capture.ts';

const site = new URL('../../../site/', import.meta.url);

/** `createWorld(…, { physics })` with a value the engine reads as on; an option before it may
 *  hold a call. */
const OPTION_ON =
  /\bcreateWorld\((?:[^()]|\([^()]*\))*?\bphysics\b(?!['"]?\s*:\s*(?:false|null|undefined)\b)/;

/**
 * Whether an example's source turns physics on through the public API: `createWorld(…, {
 * physics })` with any value but `false`, `null` or `undefined`, or `physics.enabled = true`.
 * Nothing else starts the world's physics (`worldPhysics.ts`), so only such a page fetches the
 * physics session's code, the worker and Jolt's module (#395, #397).
 */
export const turnsPhysicsOn = (source: string) =>
  OPTION_ON.test(source) || /\bphysics\.enabled\s*=\s*true\b/.test(source);

/** The ids of the `entries` whose page turns physics on, each read from its own file (#503). */
export async function physicsExamples(entries: readonly GalleryEntry[]): Promise<Set<string>> {
  const pages = await Promise.all(
    entries.map(async ({ id, file }) => [id, await readFile(new URL(file, site), 'utf8')] as const),
  );
  return new Set(pages.filter(([, html]) => turnsPhysicsOn(html)).map(([id]) => id));
}
