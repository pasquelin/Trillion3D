import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { CUTOUT_SHEET_FILE, CUTOUT_SHEET_VERSION } from '../sdk-core/src/index.ts';

/**
 * The cutout answer sheet a compile leaves beside every model, read and written.
 *
 * The compiler classifies a material as a cutout only when this sheet answers `cutout: true` for
 * the texture's image; it never guesses. An answer is keyed by the sha256 of the image bytes, so
 * one answer covers every model that shares that texture — which is why the sheets are read as a
 * batch and written as a batch.
 */
export const SHEET_FILE = CUTOUT_SHEET_FILE;

interface SheetTexture {
  image?: string;
  used?: boolean;
  measure?: Record<string, number>;
  blendPrimitives?: number;
  proposal?: 'cutout' | 'blend';
  cutout?: boolean | null;
}
export interface Sheet {
  version: number;
  textures: Record<string, SheetTexture>;
}

/** One texture waiting for an answer, and every model of the batch that carries it. */
export interface PendingCutout {
  sha256: string;
  image: string;
  proposal: boolean;
  blendPrimitives: number;
  measure: Record<string, number>;
  models: string[];
}

function isSheet(value: unknown): value is Sheet {
  const sheet = value as Sheet | null;
  return Boolean(
    sheet && typeof sheet === 'object' && sheet.textures && typeof sheet.textures === 'object',
  );
}

/** The sheet of a compiled model, or `null` when it has none — a cache wiped, a model never built. */
export async function readSheet(cache: string): Promise<Sheet | null> {
  const text = await readFile(join(cache, SHEET_FILE), 'utf8').catch(() => null);
  if (text === null) return null;
  const parsed: unknown = JSON.parse(text);
  if (!isSheet(parsed)) throw new Error(`${join(cache, SHEET_FILE)} is not an answer sheet`);
  if (parsed.version !== CUTOUT_SHEET_VERSION)
    throw new Error(`${join(cache, SHEET_FILE)} declares version ${parsed.version}`);
  return parsed;
}

/**
 * The textures of a whole batch that nobody has answered yet, one line per image however many
 * models share it, heaviest first: what it costs to leave a texture in blend is the number of
 * primitives it still holds there, summed over the batch.
 */
export function pendingOf(loaded: readonly { name: string; sheet: Sheet }[]): PendingCutout[] {
  const pending = new Map<string, PendingCutout>();
  for (const { name, sheet } of loaded) {
    for (const [sha256, texture] of Object.entries(sheet.textures)) {
      if (texture.used !== true || texture.cutout !== null) continue;
      const known = pending.get(sha256);
      if (known) {
        known.blendPrimitives += texture.blendPrimitives ?? 0;
        known.models.push(name);
        continue;
      }
      pending.set(sha256, {
        sha256,
        image: texture.image ?? sha256.slice(0, 12),
        proposal: texture.proposal === 'cutout',
        blendPrimitives: texture.blendPrimitives ?? 0,
        measure: texture.measure ?? {},
        models: [name],
      });
    }
  }
  return [...pending.values()].sort((a, b) => b.blendPrimitives - a.blendPrimitives);
}

/**
 * Writes the answers into a model's sheet, and says whether that model changed. Only textures the
 * sheet already knows are touched: an answer for a texture this model does not use belongs to its
 * own sheet, not to this one. The write goes through a neighbour file, so an interrupted run never
 * leaves half a sheet behind.
 */
export async function answerSheet(
  cache: string,
  sheet: Sheet,
  answers: Map<string, boolean>,
): Promise<boolean> {
  let changed = false;
  for (const [sha256, cutout] of answers) {
    const texture = sheet.textures[sha256];
    if (!texture || texture.cutout === cutout) continue;
    texture.cutout = cutout;
    changed = true;
  }
  if (!changed) return false;
  const target = join(cache, SHEET_FILE);
  const pending = `${target}.pending`;
  await writeFile(pending, `${JSON.stringify(sheet, null, 2)}\n`);
  await rename(pending, target);
  return true;
}
