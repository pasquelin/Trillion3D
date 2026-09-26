/** The share of each masked texture's texels at or above its chain's cutoff byte, at every level
 *  of a compiled cache, relative to level 0: the measure of #44 (coverage within ±2.5 % at every
 *  level). The head levels are read from the files the manifest's template names, the sidecar
 *  tail through the engine's own decoder. One JSON line per coverage chain.
 *
 *  `node scripts/texture-coverage-levels.ts <cache directory> [scope, `full` by default]` */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  decodeManifestPreviews,
  previewLevelSize,
  textureLevelUrl,
  type SlimClusterManifest,
} from '../packages/sdk-core/src/index.ts';
import { previewCoverageCutoff } from '../packages/sdk-core/src/texture/previewFormat.ts';
import { decodePng } from '../packages/sdk-node/src/cutout/png.mts';
import { manifestOf } from '../packages/sdk-node/src/cutout/thumb.mts';

/** The cutoff a coverage chain that names none is measured at — develop's word 2, before #44 —:
 *  glTF's default `alphaCutoff` of 0.5, so both sides of a comparison count the same texels. */
export const UNCUT_BYTE = 128;

/** One level: its size, the texels at or above the cutoff, and their share against level 0's. */
export interface CoverageLevel {
  level: number;
  size: [number, number];
  covered: number;
  relative: number;
}

/** Every coverage chain of a manifest whose chain is whole, `readHead` giving the bytes of a head
 *  level's lossless file from its address relative to the manifest. */
export async function coverageLevels(
  slim: SlimClusterManifest,
  buffer: ArrayBuffer,
  readHead: (url: string) => Promise<Uint8Array>,
) {
  const chains = [];
  for (const preview of decodeManifestPreviews(slim, buffer)) {
    const named = previewCoverageCutoff(preview.atlas);
    if (named === undefined || preview.bakedLevels < preview.firstLevel || !slim.textures) continue;
    const cutoff = named || UNCUT_BYTE;
    const head = await Promise.all(
      Array.from({ length: preview.firstLevel }, async (_, level) => {
        const url = textureLevelUrl(
          slim.textures!.url,
          preview.sha256,
          preview.atlas,
          level,
          'png',
        );
        return decodePng(await readHead(url)).rgba;
      }),
    );
    const counts = [...head, ...preview.levels].map((rgba) => {
      let covered = 0;
      for (let at = 3; at < rgba.length; at += 4) if ((rgba[at] ?? 0) >= cutoff) covered++;
      return { covered, texels: rgba.length / 4 };
    });
    const share0 = (counts[0]?.covered ?? 0) / (counts[0]?.texels ?? 1);
    const levels: CoverageLevel[] = counts.map(({ covered, texels }, level) => ({
      level,
      size: previewLevelSize(preview.width, preview.height, level),
      covered,
      relative: covered / texels / share0 - 1,
    }));
    chains.push({ texture: preview.texture, sha256: preview.sha256, cutoff, levels });
  }
  return chains;
}

async function main() {
  const [cache, scope = 'full'] = process.argv.slice(2);
  if (!cache) throw new Error('usage: node scripts/texture-coverage-levels.ts <cache> [scope]');
  const manifest = await manifestOf(cache, scope);
  if (!manifest) throw new Error(`${cache}: no compiled manifest for scope ${scope}`);
  const { directory, slim, buffer } = manifest;
  const read = async (url: string) => new Uint8Array(await readFile(join(directory, url)));
  for (const chain of await coverageLevels(slim, buffer, read)) console.log(JSON.stringify(chain));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
