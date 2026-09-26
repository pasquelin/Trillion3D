/** The measure of #44: each coverage chain of a compiled cache, its share of texels at or above
 *  its cutoff byte at every level against level 0's, one JSON line per chain — the head from the
 *  files the manifest names, the tail through the engine's own decoder.
 *  `node scripts/texture-coverage-levels.ts <cache directory> [scope, full by default]` */
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

/** Where a chain that names no cutoff — develop's word 2, before #44 — is counted: glTF's default
 *  `alphaCutoff` of 0.5, so both sides of a comparison count the same texels. */
const UNCUT_BYTE = 128;

/** Every whole coverage chain of a manifest, `readHead` giving a head level's lossless file from
 *  its address relative to the manifest. */
export async function coverageLevels(
  slim: SlimClusterManifest,
  buffer: ArrayBuffer,
  readHead: (url: string) => Promise<Uint8Array>,
) {
  const chains = [];
  for (const preview of decodeManifestPreviews(slim, buffer)) {
    const named = previewCoverageCutoff(preview.atlas);
    const template = slim.textures?.url;
    if (named === undefined || !template || preview.bakedLevels < preview.firstLevel) continue;
    const cutoff = named || UNCUT_BYTE;
    const head = await Promise.all(
      Array.from({ length: preview.firstLevel }, async (_, level) => {
        const url = textureLevelUrl(template, preview.sha256, preview.atlas, level, 'png');
        return decodePng(await readHead(url)).rgba;
      }),
    );
    const covered = [...head, ...preview.levels].map((rgba) => {
      let count = 0;
      for (let at = 3; at < rgba.length; at += 4) if ((rgba[at] ?? 0) >= cutoff) count++;
      return [count, rgba.length / 4] as const;
    });
    const [covered0 = 0, texels0 = 1] = covered[0] ?? [];
    const levels = covered.map(([count, texels], level) => ({
      level,
      size: previewLevelSize(preview.width, preview.height, level),
      covered: count,
      relative: (count * texels0) / (texels * covered0) - 1,
    }));
    chains.push({ texture: preview.texture, sha256: preview.sha256, cutoff, levels });
  }
  return chains;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cache = '', scope = 'full'] = process.argv.slice(2);
  const manifest = await manifestOf(cache, scope);
  if (!manifest) throw new Error(`${cache}: no compiled manifest for scope ${scope}`);
  const read = async (url: string) => new Uint8Array(await readFile(join(manifest.directory, url)));
  for (const chain of await coverageLevels(manifest.slim, manifest.buffer, read))
    console.log(JSON.stringify(chain));
}
