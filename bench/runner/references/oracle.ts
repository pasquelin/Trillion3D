#!/usr/bin/env node
// =====================================================================================
// Rebound oracle campaign: converged indirect irradiance of the engine compared against
// the compiler path tracer. Single command, no manual server launch required:
//
//   node bench/runner/references/oracle.ts --cache .mesure/cache-piece --source piece/piece.gltf \
//        --resources piece --width 160 --height 120 --lights 1 --samples 256 --visible
//
// Engine and oracle receive identical pose, lights, and size. Engine renders `bounce` view —
// raw indirect irradiance multiplied by exposure. Oracle computes same value on source triangles.
// NO TIMING PROMISED HERE: this is a fidelity measurement, not a speed test.
// =====================================================================================
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CameraPose } from '../../../packages/sdk-core/src/index.ts'
import { launchChrome } from '../harness/chrome.ts'
import { ENGINES, resolveCache } from '../harness/sideOptions.ts'
import { VIEWS, poseAt } from '../trajectory/poses.ts'
import { parseArgs } from '../harness/flags.ts'
import { resolveMounts } from '../harness/options.ts'
import { resolveSides, sdkEntryUrl } from '../harness/dists.ts'
import { startServer, type Capture } from '../../../tests/kit/server/staticServer.ts'
import { readStreet } from '../street/street.ts'
import { benchLights } from '../lighting/lamps.ts'
import { oracleBuilt } from './oracleCompare.ts'
import { runView } from './oracleView.ts'
import type { OracleSettings, OracleView } from './oracleView.ts'
import { measureOutput } from '../../core/paths.ts'
import { REPOSITORY_ROOT } from '../../../scripts/repository-files.ts'
import { git } from '../../../scripts/git-paths.ts'

const args = process.argv.slice(2)
// Same flag reader as benchmark: `--name value`, `--name=value`, `--name` alone.
const flags = parseArgs(args)
function flag(name: string): string | undefined
function flag(name: string, fallback: string): string
function flag(name: string, fallback?: string): string | undefined {
  return flags.get(name) ?? fallback
}
const number = (name: string, fallback: number) => Number(flag(name, String(fallback)))

/** Three comma-separated numbers, or null. Used for manual poses. */
const triple = (name: string): [number, number, number] | null => {
  const value = flag(name)
  if (!value || value === 'true') return null
  const parts = value.split(',').map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part)))
    throw new Error(`--${name} expects three comma-separated numbers`)
  return parts as [number, number, number]
}

async function main() {
  const cache = resolveCache(flag('cache'))
  if (!cache) throw new Error('--cache is required: the compiled cache derived directory')
  const source = resolve(flag('source', ''))
  if (!existsSync(source)) throw new Error(`--source not found: ${source}`)
  if (!oracleBuilt(REPOSITORY_ROOT)) throw new Error('oracle missing: run `pnpm run build:native`')
  const out = resolve(flag('out', measureOutput(`oracle-${Date.now()}`)))
  const settings: OracleSettings = {
    width: number('width', 160),
    height: number('height', 120),
    samples: number('samples', 256),
    bounces: number('bounces', 2),
    exposure: number('exposure', 0.2),
    converge: number('converge', 24),
    delayFrames: number('delay-frames', 40),
    delayMargin: number('delay-margin', 1.2),
    floor: number('floor', 0.01),
    cadenceHz: number('cadence', 60),
    lamps: number('lights', 1),
    // Same generic rule as benchmark: point light intensity is a measurement option.
    intensity: number('intensity', 40),
    rangeFactor: number('range', 0.75),
    shadows: flag('shadows', 'on') === 'on',
    pixelError: number('pixelError', 0),
    maxPages: number('max-pages', 100000),
    source,
  }
  const after = flag('after')
  const resources = flag('resources')
  const visible = flag('visible', 'false') === 'true'
  // Read before the refusal: the step's default needs the scene bounds, known only in the page.
  const stepFlag = flag('step')
  const camera = triple('pose'),
    target = triple('target')
  const views = flag('views', 'overview').split(',')
  flags.refuseUnread()
  await mkdir(out, { recursive: true })
  const sides = resolveSides({ after, root: REPOSITORY_ROOT })
  const side = sides[0]
  side.cache = cache
  const manifestUrl = `/cache/${side.name}/native/full/manifest.json`
  side.manifestUrl = manifestUrl
  const mounts = resolveMounts(REPOSITORY_ROOT, sides, resources ? resolve(resources) : null)
  const captures = new Map<string, Capture>()
  const { server, port } = await startServer({ mounts, captures })
  const browser = await launchChrome({
    headless: !visible,
    args: ENGINES.webgpu.flags,
  })
  const report: {
    startedAt: string
    command: string
    head: string
    settings: typeof settings
    views: OracleView[]
  } = {
    startedAt: new Date().toISOString(),
    command: `node bench/runner/references/oracle.ts ${args.join(' ')}`,
    head: git(REPOSITORY_ROOT, 'rev-parse', 'HEAD'),
    settings,
    views: [],
  }
  try {
    const page = await browser.newPage({
      viewport: { width: settings.width, height: settings.height },
    })
    page.on('pageerror', (error) => report.views.push({ error: String(error) }))
    // A rejected shader does not come through `pageerror`: it logs as console warning/error.
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning')
        console.error('[page]', m.type(), m.text().slice(0, 600))
    })
    await page.goto(`http://127.0.0.1:${port}/`)
    // The box, then the street the eye-level views walk (`street/street.ts`), as the bench reads it.
    const urls = { sdkUrl: sdkEntryUrl(side), manifestUrl }
    const bounds = await readStreet(page, urls)
    const lights = benchLights(bounds, {
      lights: settings.lamps,
      lightShadows: settings.shadows,
      lightIntensity: settings.intensity,
      lightRangeFactor: settings.rangeFactor,
      sun: false,
      movingLight: false,
    })
    const movingCandidate = lights && lights.lights.find((light) => light.kind === 'point')
    if (!lights || !movingCandidate || !movingCandidate.position)
      throw new Error('--lights must declare at least one point light')
    const moving = { id: movingCandidate.id, position: movingCandidate.position }
    // Light step: clear enough that rebound must reconverge.
    const step = Number(stepFlag ?? Math.max(1, (bounds.max.x - bounds.min.x) * 0.25))
    for (const view of views) {
      // Manual pose overrides benchmark trajectory.
      const known = VIEWS[view as keyof typeof VIEWS]
      if (!known && !camera) throw new Error(`unknown view: ${view}`)
      const pose: CameraPose = camera
        ? { ...poseAt(bounds, 0), position: camera, target: target ?? [0, 0, 0] }
        : poseAt(bounds, known.index)
      report.views.push(
        await runView(page, {
          side,
          manifestUrl,
          settings,
          pose,
          view,
          lights,
          moving,
          step,
          out,
          captures,
          root: REPOSITORY_ROOT,
        }),
      )
    }
  } finally {
    await browser.close()
    server.close()
  }
  await writeFile(join(out, 'oracle.json'), JSON.stringify(report, null, 1))
  console.log(JSON.stringify(report, null, 1))
  if (report.views.some((view) => view.error)) process.exitCode = 1
}

await main()
