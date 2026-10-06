#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { launchChrome } from '../harness/chrome.ts'
import { ENGINES, parseArgs, resolveMounts, sdkEntryUrl, VIEWS } from '../harness/options.ts'
import { assetsManifest, sceneDerived } from '../assets/scene.ts'
import { summarizeFeedbackRun } from './feedbackTargetReport.ts'
import { startServer, type Capture } from '../../../tests/kit/server/staticServer.ts'
import { encodePng } from '../../../packages/sdk-node/src/cutout/png.mts'
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../..')
const flags = parseArgs(process.argv.slice(2))
const scenes = (flags.get('scene') ?? 'sponza,alpha-blend-mode-test').split(',').filter(Boolean)
const views = (flags.get('views') ?? 'overview,ground,street').split(',').filter(Boolean)
const frames = Number(flags.get('images') ?? 120)
const pixelError = Number(flags.get('pixelError') ?? 0)
const output = resolve(flags.get('out') ?? join(ROOT, '.mesure/out/39-feedback-ab'))
const dist = resolve(flags.get('dist') ?? join(ROOT, 'dist'))
const rebuild = (flags.get('rebuild-cache') ?? '').split(',').filter(Boolean)
const headless = flags.get('visible') !== 'true'
flags.refuseUnread()
if (!Number.isInteger(frames) || frames < 12) throw new Error('--images must be at least 12')
if (!Number.isFinite(pixelError) || pixelError < 0)
  throw new Error('--pixelError must be nonnegative')
for (const view of views) if (!(view in VIEWS)) throw new Error(`unknown view: ${view}`)
for (const scene of rebuild)
  if (!scenes.includes(scene))
    throw new Error(`--rebuild-cache names a scene outside --scene: ${scene}`)
async function main() {
  await mkdir(output, { recursive: true })
  for (const scene of scenes) {
    const args = [
      'bench/runner/assets/assets.ts',
      '--only',
      scene,
      ...(rebuild.includes(scene) ? ['--rebuild'] : []),
    ]
    const prepared = spawnSync('node', args, { cwd: ROOT, stdio: 'inherit' })
    if (prepared.error) throw prepared.error
    if (prepared.status !== 0) throw new Error(`asset preparation failed for ${scene}`)
  }
  const side = { name: 'probe', dist, from: 'folder' }
  const captures = new Map<string, Capture>()
  const { server, port } = await startServer({ mounts: resolveMounts(ROOT, [side]), captures })
  const report = {
    command: `node bench/runner/feedback/feedbackTargetAb.ts ${process.argv.slice(2).join(' ')}`,
    head: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    size: { width: 2496, height: 1404, dpr: 1 },
    frames,
    pixelError,
    taa: true,
    dist,
    runs: [] as unknown[],
  }
  try {
    for (const scene of scenes) {
      const manifestUrl = assetsManifest(scene, true)
      const browser = await launchChrome({
        headless,
        args: ENGINES.webgpu.flags,
      })
      try {
        const page = await browser.newPage({
          viewport: { width: 2496, height: 1404 },
          deviceScaleFactor: 1,
        })
        const incidents: string[] = []
        page.on('pageerror', (error) => incidents.push(String(error)))
        page.on('console', (message) => {
          if (message.type() === 'error') incidents.push(message.text())
        })
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' })
        for (const view of views) {
          const raw = await page.evaluate(
            async (options) => {
              const module = await import('/runner/feedback/feedbackTargetPage.ts')
              return module.runFeedbackTarget(options)
            },
            {
              sdkUrl: sdkEntryUrl(side),
              manifestUrl,
              scene,
              view: VIEWS[view as keyof typeof VIEWS].index,
              frames,
              pixelError,
            },
          )
          const files = [
            ...(raw.convergence?.captures.map((entry) => entry.file) ?? []),
            ...raw.readings.map((reading) => reading.capture),
          ]
          for (const file of files) {
            const capture = captures.get(file)
            if (capture)
              await writeFile(
                join(output, file.replace(/\.rgba$/, '.png')),
                encodePng(capture.w, capture.h, capture.body, true),
              )
          }
          report.runs.push({
            ...summarizeFeedbackRun(raw, scene, view, captures, incidents),
            cache: sceneDerived(scene),
          })
        }
        await page.close()
      } finally {
        await browser.close()
      }
    }
  } finally {
    await new Promise((done) => server.close(done))
  }
  await writeFile(join(output, 'feedback-target-ab.json'), JSON.stringify(report, null, 2))
  process.stdout.write(`Feedback A/B/A: ${join(output, 'feedback-target-ab.json')}\n`)
}
await main().catch((error) => {
  process.stderr.write(String(error?.stack ?? error) + '\n')
  process.exitCode = 1
})
