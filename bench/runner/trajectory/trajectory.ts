#!/usr/bin/env node
// Acceptance entry point. Goldens come from an explicit built baseline, repeated for stable A/A.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { launchChrome } from '../harness/chrome.ts'
import { startServer, type Capture } from '../../../tests/kit/server/staticServer.ts'
import { encodePng } from '../../../packages/sdk-node/src/cutout/png.mts'
import { fingerprintBuild } from '../../../scripts/write-build-provenance.ts'
import { assetIdentity } from '../report/provenance.ts'
import { readOptions, resolveMounts, equipSide, sdkEntryUrl } from '../harness/options.ts'
import { isDist } from '../harness/dists.ts'
import { isEngine, resolveCache, sideReport } from '../harness/sideOptions.ts'
import { ASSETS, DEFAULT_SCENE, sceneDerived, sceneOf } from '../assets/scene.ts'
import { PATH_POSES, PATH_VERSION, poseAt, trajectoryPoses } from './poses.ts'
import { readStreet } from '../street/street.ts'
import { benchLights } from '../lighting/lamps.ts'
import { measurePayload, withGpuIncidents } from '../series/seriesPage.ts'
import { checkpointIndices, trajectoryVerdict } from './trajectoryProof.ts'
import type { captureTrajectory } from './trajectoryPage.ts'

async function main() {
  const root = resolve(import.meta.dirname, '../../..')
  const { flags, settings, out, resources } = readOptions(
    [
      '--engine',
      'webgpu',
      '--images',
      String(PATH_POSES),
      '--textures',
      'cache',
      ...process.argv.slice(2),
    ],
    root,
  )
  const indices = checkpointIndices(settings.frames, Number(flags.get('checkpoint-every') ?? 60))
  if (settings.pixelErrors.length !== 1) throw new Error('trajectory requires one pixelError')
  // Side names are the bench's flags: the baseline first, then the candidate.
  const names = ['before', 'after']
  if (!flags.has(names[0]))
    throw new Error(`--${names[0]} must name a built golden baseline directory`)
  if ([...flags.keys()].some((flag) => flag.startsWith('cache-')))
    throw new Error('use --cache for the identical cache on both sides')
  if (settings.movingLight || settings.movingNode || settings.livePools)
    throw new Error('trajectory supports camera motion only, with fixed memory budgets')
  settings.stageProfile = false
  const named = flags.get('scene')
  const cache = resolveCache(flags.get('cache') ?? sceneDerived(named ?? DEFAULT_SCENE, ASSETS))!
  // A `--cache` alone names its scene: the evidence never records Sponza for another cache.
  const scene = named ?? sceneOf(cache)
  const sides = names.map((name) => {
    const dist = resolve(flags.get(name) ?? join(root, 'dist'))
    flags.set(`cache-${name}`, cache)
    const side = equipSide({ name, dist, from: 'folder' }, flags, settings)
    side.manifestUrl = `/cache/${name}/native/full/manifest.json`
    if (!isEngine(side.engine) || side.variant || side.errorMetric)
      throw new Error('trajectory requires the standard WebGPU engine on both sides')
    if (!isDist(dist)) throw new Error(`built SDK missing: ${dist}`)
    return side
  })
  flags.refuseUnread()
  if (sides[0].compression !== sides[1].compression)
    throw new Error('texture compression must match on both sides')
  const builds = await Promise.all(
    sides.map(async (side) => (await fingerprintBuild(side.dist)).hash),
  )
  const captures = new Map<string, Capture>()
  const report = {
    scene,
    pathVersion: PATH_VERSION,
    settings,
    indices,
    assetKey: assetIdentity(cache),
    sides: sides.map((side, i) => ({ ...sideReport(side)[1], buildHash: builds[i] })),
    browser: '',
    runs: [] as Awaited<ReturnType<typeof captureTrajectory>>[],
    verdicts: [] as ReturnType<typeof trajectoryVerdict>[],
    errors: [] as string[],
  }
  // Refuse to overwrite goldens or previous evidence.
  const outputPath = relative(join(root, '.mesure/out'), out)
  if (!outputPath || outputPath.startsWith('..'))
    throw new Error('--out must be under .mesure/out/')
  await mkdir(dirname(out), { recursive: true })
  await mkdir(out, { recursive: false })
  const { server, port } = await startServer({
    mounts: resolveMounts(root, sides, resources),
    captures,
    isolation: settings.isolation,
  })
  try {
    let bounds: Awaited<ReturnType<typeof readStreet>> | undefined
    let poses: ReturnType<typeof poseAt>[] = []
    const passes = [
      ['golden', sides[0]],
      ['golden-aa', sides[0]],
      ['candidate', sides[1]],
    ] as const
    for (const [label, side] of passes) {
      const browser = await launchChrome({ headless: !settings.visible, args: side.engine.flags })
      try {
        report.browser = browser.version()
        const page = await browser.newPage({
          viewport: { width: settings.width, height: settings.height },
          deviceScaleFactor: settings.dpr,
        })
        page.setDefaultTimeout(120_000)
        page.on('pageerror', (error) => report.errors.push(error.message))
        page.on('console', (message) => {
          if (message.type() === 'error') report.errors.push(message.text())
        })
        page.on('response', (response) => {
          if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`)
        })
        await page.goto(`http://127.0.0.1:${port}/`)
        if (!bounds) {
          // The box, then the street the eye-level poses walk (`street/street.ts`), as the bench reads it.
          const urls = { sdkUrl: sdkEntryUrl(side), manifestUrl: side.manifestUrl! }
          bounds = await readStreet(page, urls)
          poses = trajectoryPoses(bounds, 0, settings.frames)
        }
        const payload = measurePayload(
          side,
          settings.pixelErrors[0],
          poses[0],
          poses,
          label,
          settings,
          benchLights(bounds, settings),
          side.manifestUrl!,
        )
        const run = await withGpuIncidents(page, () =>
          page.evaluate(
            async ({ payload, indices, captureArrival }) => {
              const module = (await import(
                `${payload.modulesUrl}trajectory/trajectoryPage.ts`
              )) as {
                captureTrajectory: typeof captureTrajectory
              }
              return module.captureTrajectory(payload, indices, captureArrival)
            },
            { payload, indices, captureArrival: label === 'candidate' },
          ),
        )
        report.runs.push(run)
        if (!run.drawn || run.coverageFailures.length || run.incidents.length)
          report.errors.push(`${label}: missing coverage, no geometry drawn, or GPU incidents`)
      } finally {
        await browser.close()
      }
    }
    const [reference, repeat, candidate] = report.runs
    report.verdicts = reference.checkpoints.map((checkpoint, i) =>
      trajectoryVerdict(checkpoint, repeat.checkpoints[i], candidate.checkpoints[i], captures),
    )
  } catch (error) {
    report.errors.push(String(error))
  } finally {
    await new Promise<void>((done) => server.close(() => done()))
    for (const [file, capture] of captures)
      if (capture)
        await writeFile(join(out, file), encodePng(capture.w, capture.h, capture.body, true))
    await writeFile(join(out, 'trajectory.json'), JSON.stringify(report, null, 2))
  }
  if (
    report.errors.length ||
    report.verdicts.length !== indices.length ||
    report.verdicts.some(({ status }) => status !== 'match' && status !== 'transient')
  )
    throw new Error(`trajectory proof failed: ${join(out, 'trajectory.json')}`)
  console.log(`trajectory proof passed: ${join(out, 'trajectory.json')}`)
}

await main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
