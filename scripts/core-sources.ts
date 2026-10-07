import { existsSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { Metafile } from 'esbuild'

/** Beside the CDN bundle, the sources each of its files holds: `build-bundle.ts` writes it from
 *  esbuild's metafile, `cleanBundle` removes it with the bundle, the package never ships it. */
export const BUNDLE_SOURCES = 'trillion3d.module.js.sources.json'

/** Each output file of the bundle at `dist`, by name: its sources, under `dist`, and the minified
 *  bytes each one takes in it. */
type BundleSources = Record<string, Record<string, number>>

/** The `BundleSources` of an esbuild metafile whose outputs and inputs lie under `dist`. */
export function bundleSources(metafile: Metafile, dist: string): BundleSources {
  const under = (path: string) => relative(dist, resolve(path)).replaceAll('\\', '/')
  return Object.fromEntries(
    Object.entries(metafile.outputs)
      .filter(([file]) => file.endsWith('.js'))
      .map(([file, { inputs }]) => [
        under(file),
        Object.fromEntries(
          Object.entries(inputs).map(([path, { bytesInOutput }]) => [under(path), bytesInOutput]),
        ),
      ]),
  )
}

/**
 * The sources the core must never hold (#1353): the measurement, fetched only in debug mode, and
 * the renderer's own code, fetched only by a page that draws. A family's own module in the core
 * already fails the gate by name (`familiesInCore`); these are the sources around them.
 */
const NOT_IN_CORE = {
  measurement: ['sdk-browser/src/measurement/'],
  'the WebGPU renderer': ['sdk-browser/src/webgpu/pages/'],
  'the WebGPU shadows': [
    'sdk-browser/src/gpu/shadow/',
    'sdk-browser/src/webgpu/shadow/',
    'sdk-browser/src/vsm/',
  ],
}
/** The shadows' constants and lean size modules, which import no pass, pipeline nor other shader
 *  text: the world's settings read the shadows' defaults from the constants, and the memory budget
 *  the core splits at a world's creation reads its shadow shares from the size modules
 *  (`residency/shadowBudgetBytes.ts`): only them of the shadows' folders. */
const SHADOW_SIZES = [
  'sdk-browser/src/vsm/constants.js',
  'sdk-browser/src/vsm/layout.js',
  'sdk-browser/src/vsm/transmissionLayout.js',
]

/** The folder a source is listed under: its package's own `src/` and the folder below it. */
const folderOf = (source: string) => {
  const parts = source.split('/')
  const depth = parts[1] === 'src' ? 3 : 2
  return parts.length > depth ? parts.slice(0, depth).join('/') : source
}

/**
 * The core's sources at `dist`, `files` being its files: the minified bytes of each source folder,
 * the largest first, and what of `NOT_IN_CORE` it holds, by name and source. `null` without the
 * sources file: a bundle built before it existed.
 */
export function coreSources(dist: string, files: readonly string[]) {
  const path = join(dist, BUNDLE_SOURCES)
  if (!existsSync(path)) return null
  const sources = JSON.parse(readFileSync(path, 'utf8')) as BundleSources
  const held = new Map<string, number>()
  for (const file of files)
    for (const [source, bytes] of Object.entries(sources[file] ?? {}))
      if (bytes > 0) held.set(source, (held.get(source) ?? 0) + bytes)
  const folders = new Map<string, number>()
  for (const [source, bytes] of held)
    folders.set(folderOf(source), (folders.get(folderOf(source)) ?? 0) + bytes)
  const forbidden = Object.entries(NOT_IN_CORE).flatMap(([name, prefixes]) =>
    [...held.keys()]
      .filter((source) => prefixes.some((prefix) => source.startsWith(prefix)))
      .filter((source) => !SHADOW_SIZES.includes(source))
      .map((source) => `${name} (${source})`),
  )
  return { folders: [...folders].sort((a, b) => b[1] - a[1]), forbidden }
}
