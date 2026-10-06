#!/usr/bin/env node
// `pnpm run check:bundle-size`: the gzip size of the CDN core against its budget, after `build`.
// The core is what a page downloads before its first frame: `dist/trillion3d.module.js` and every
// chunk it imports statically. A chunk it imports dynamically — an optional family, a renderer —
// is fetched on first use and is not counted; neither are the workers and the WebAssembly modules.
// Every family module (`bundle-fold.ts`) must be such a chunk: one the core holds fails the gate,
// by name; so does a source the core must never hold (`NOT_IN_CORE`). The core is listed by source
// folder. gzip is measured with CI's Node, whose zlib the budget was set with.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { BUNDLE_ENTRY } from './build-bundle.ts'
import { FAMILY_MODULES, familyChunks, type Family } from './bundle-fold.ts'
import { coreSources } from './core-sources.ts'

/** The budget of the gzip core, in bytes: the 255 319 bytes CI's Node measured once each renderer,
 *  its shadow passes and the debug tools — the frame report and the pass table among them — left
 *  the core (#1353, 693 537 bytes before), and about 3.7 kB of margin. A declared value, not a
 *  derived one; a pull request that crosses it says why, and raises it. */
const CORE_BUDGET_BYTES = 259_000

/** `from"./x.js"` and a bare `import"./x.js"`, as esbuild writes them, never `import("./x.js")`. */
const STATIC_IMPORT = /(?:\bfrom\s*|\bimport\s*)(["'])(\.\/[^"']+)\1/g

/** The files of the core: `entry` and the chunks it imports statically, transitively. */
export function coreFiles(dist: string, entry = BUNDLE_ENTRY): string[] {
  const found = [entry]
  for (let at = 0; at < found.length; at++)
    for (const [, , path] of readFileSync(join(dist, found[at]), 'utf8').matchAll(STATIC_IMPORT)) {
      const name = path.slice(2)
      if (!found.includes(name)) found.push(name)
    }
  return found
}

/** The family modules the core holds instead of fetching them on first use: those the build
 *  made no chunk of, and those whose chunk the core imports statically. */
export function familiesInCore(dist: string, files = coreFiles(dist)) {
  return (Object.keys(FAMILY_MODULES) as Family[]).flatMap((family) =>
    familyChunks(dist, family)
      .filter(({ chunk }) => !chunk || files.includes(chunk))
      .map(({ module }) => `${family} (${module})`),
  )
}

/** The core's gzip size, its source folders, and the lines the CI prints. */
export function coreSize(dist: string, budget = CORE_BUDGET_BYTES) {
  const files = coreFiles(dist),
    held = familiesInCore(dist, files),
    sources = coreSources(dist, files)
  const bytes = files.reduce(
    (sum, name) => sum + gzipSync(readFileSync(join(dist, name)), { level: 9 }).length,
    0,
  )
  const within = bytes <= budget,
    forbidden = sources?.forbidden ?? []
  const families = held.length
    ? `, and holds ${held.join(', ')}, to be loaded on first use`
    : `; ${Object.keys(FAMILY_MODULES).join(', ')} load on first use`
  const folders = (sources?.folders ?? []).map(
    ([folder, size]) => `  ${(size / 1000).toFixed(1).padStart(7)} kB  ${folder}`,
  )
  return {
    bytes,
    fits: within && !held.length && !forbidden.length,
    line: `CDN core: ${bytes} bytes gzip in ${files.length} files, ${within ? 'within' : 'OVER'} its budget of ${budget}${families}`,
    folders: sources
      ? [`CDN core by source folder, minified:`, ...folders]
      : ['CDN core by source folder: no sources file, rebuild with `pnpm run build`'],
    forbidden: forbidden.map((source) => `CDN core holds ${source}, which it must never hold`),
  }
}

/** CI's Node, the one the budget is measured with (`.github/actions/node/action.yml`). */
export function ciNode(root = '.') {
  const action = readFileSync(join(root, '.github/actions/node/action.yml'), 'utf8')
  return /node-version:\s*'([\d.]+)'/.exec(action)?.[1]
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ci = ciNode()
  const ciBinary = join(
    process.env.NVM_DIR ?? join(homedir(), '.nvm'),
    `versions/node/v${ci}/bin/node`,
  )
  if (ci && process.versions.node !== ci && existsSync(ciBinary))
    process.exit(spawnSync(ciBinary, process.argv.slice(1), { stdio: 'inherit' }).status ?? 1)
  const { fits, line, folders, forbidden } = coreSize(resolve('dist'))
  console.log([line, ...forbidden, ...folders].join('\n'))
  if (ci && process.versions.node !== ci)
    console.log(
      `Measured with Node ${process.versions.node}, not CI's ${ci}: its zlib compresses otherwise, ` +
        `so this size is not the one CI measures (install Node ${ci} with nvm to read CI's).`,
    )
  if (!fits) process.exit(1)
}
