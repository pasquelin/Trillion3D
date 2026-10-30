// One play of a scenario on its page, in this process: the page opened as the browser opens it,
// warmed until its images are timed, then each segment played and measured on its own.
import { createCalibration, CALIBRATION_BYTES } from '../machine/calibration.ts'
import { captureCanvas } from '../capture/capture.ts'
import { functionTimes, startCpuProfile } from '../machine/cpuProfile.ts'
import { installGpu } from '../machine/device.ts'
import { dissectModules, dissectSpec } from '../passes/dissectHooks.ts'
import { installBrowser } from '../page/dom.ts'
import { machineFor } from '../machine/machine.ts'
import { REFRESH_MS, createClock, runFrames, sessionFailure, settleLoading, warmUp } from '../capture/frames.ts'
import { gpuBusy } from '../machine/gpuBusy.ts'
import type { BenchOptions } from './options.ts'
import { pageAddress, readPage, runPage } from '../page/page.ts'
import { createPlayer } from './scenario.ts'
import { runTrack } from './trackFrames.ts'
import { benchPasses } from '../passes/benchPasses.ts'
import { timerDoubts } from '../report/trust.ts'
import { countsPerFrame, passTimes, roundNumbers, spread } from '../report/summary.ts'

/** Why the world's session did not open or ended, as the engine names it: its code, its message and the cause beneath it (a device destroyed is the effect, this the reason). */
export function worldFailure(world: object) {
  const error = (world as { error?: unknown }).error as
    | {
        code?: string
        message?: string
        details?: { cause?: unknown }
        cause?: unknown
        stack?: string
      }
    | null
    | undefined
  if (!error) return 'BENCH_WORLD: the world reports no error'
  const cause = (error.details?.cause ?? error.cause) as
    { stack?: string; message?: string } | undefined
  return [
    `BENCH_WORLD: ${error.code ?? 'ERROR'} ${error.message ?? ''}`.trim(),
    cause ? `cause: ${(cause.stack ?? cause.message ?? String(cause)).slice(0, 1500)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Plays `options.scenario` once; `stem` names its images. Resolves to the play's numbers. */
export async function playScenario(options: BenchOptions, stem: string) {
  const { scenario } = options
  const busyBefore = await gpuBusy()
  const gpu = installGpu({ limits: options.profile.limits, featuresOff: options.featuresOff })
  const page = readPage(options.file)
  const address = pageAddress(options.file, options.search)
  const browser = installBrowser(options.display, address, page.canvasIds, page.elementIds)
  // The profiled play times the CPU alone: it captures nothing, its encoding would be profiled.
  const captures =
    !options.cpuProfile &&
    !options.noCapture &&
    scenario.segments.some((segment) => segment.capture)
  for (const canvas of browser.canvases) canvas.readable = captures
  const errors: string[] = []
  const opened = performance.now()
  const [world] = await runPage(options.file, options.engine.root, page.scripts)
  if (!world) throw new Error(`BENCH_PAGE: ${options.name} made no world`)
  if (options.scale !== 'page') world.renderScale = Number(options.scale)
  // The quality the page runs at. Under 'auto' a browser runs the hardware benchmark before the first image where none is kept for the
  // adapter; the bench does the same, so it measures the levels the machine is given, and says them.
  type Hardware = { groups?: unknown; gpu?: unknown } | null
  const quality = (
    world as unknown as {
      quality?: { preset?: unknown; hardware?: Hardware; benchmark?: () => Promise<Hardware> }
    }
  ).quality
  // A comparison with another engine pins the preset its reference runs at (`BENCH_QUALITY`, e.g. `max`), over the page's and the benchmark's.
  if (quality && process.env.BENCH_QUALITY) quality.preset = process.env.BENCH_QUALITY
  const found =
    quality?.preset === 'auto' && !quality.hardware && quality.benchmark
      ? await quality.benchmark()
      : (quality?.hardware ?? null)
  console.error(
    `[bench] quality: preset ${JSON.stringify(quality?.preset)}, benchmark ${JSON.stringify(found ? { groups: found.groups, gpu: found.gpu } : null)}`,
  )
  const clock = createClock()
  const rig = { browser, gpu, world }
  // The device is the engine's own, asked when its session opens: frames run until it submits.
  const deadline = performance.now() + options.timeoutS * 500
  const held = {}
  while (!gpu.held.device) {
    if (performance.now() > deadline || sessionFailure(world, held))
      throw new Error(
        `BENCH_DEVICE: the engine submitted nothing to a GPU device\n${worldFailure(world)}`,
      )
    browser.frame(clock.time)
    await new Promise((done) => setTimeout(done, 1))
  }
  const device = gpu.held.device
  device.addEventListener('uncapturederror', (event) => {
    errors.push(String((event as GPUUncapturedErrorEvent).error.message).slice(0, 400))
    // A shader that does not compile never will: the play ends at the first such error.
    if (errors.at(-1)!.includes('Error while parsing WGSL')) {
      console.error(`BENCH_WGSL: ${errors.at(-1)}`)
      process.exit(4)
    }
    if (errors.length > 20) {
      console.error(`BENCH_GPU_ERRORS: ${errors.length} errors, the first:\n${errors[0]}`)
      process.exit(4)
    }
  })
  let closing = false
  void device.lost.then((lost) => {
    if (closing) return // the bench's own dispose
    // A lost device draws nothing more: the run stops rather than measure an empty queue.
    console.error(`BENCH_DEVICE_LOST: ${lost.reason} ${lost.message.slice(0, 400)}`)
    if ((world as { error?: unknown }).error) console.error(worldFailure(world))
    process.exit(4)
  })
  const calibration = await createCalibration(gpu, device)
  // The world's time stands still until its pages have arrived: every play starts its clip, its vehicles, its sun and its exposure from the same instant.
  clock.frozen = true
  await warmUp(rig, clock, options.timeoutS * 500, 8)
  await settleLoading(rig, clock, options.timeoutS * 500)
  await runFrames(rig, clock, options.warm)
  const machine = await machineFor(
    gpu,
    device,
    gpu.held.adapter,
    options.recalibrate,
    !busyBefore?.busy,
  )
  const readySeconds = (performance.now() - opened) / 1000
  let engine: Record<string, unknown> = {}
  world.onFrame(({ metrics }) => (engine = metrics as unknown as Record<string, unknown>))
  const unit: number[] = []
  for (let i = 0; i < 10; i++) unit.push(await calibration.time())
  if (options.cpuProfile) {
    world.diagnostic.debug = true
    world.resetCpuSteps()
  }
  const stopProfile = options.cpuProfile ? await startCpuProfile() : null
  const player = createPlayer(browser, world)
  const segments = []
  for (const segment of scenario.segments) {
    player.begin(segment)
    const { track } = segment
    const slug = segment.name.replace(/\W+/g, '-')
    // The canvas's image now, under `name`; none where the segment is not captured.
    const shoot = async (name: string) => {
      const current = (browser.canvases[0].getContext('webgpu') as { current: GPUTexture | null })
        .current
      return captures && segment.capture && current
        ? await captureCanvas(gpu, device, current, `${stem}-${name}.png`)
        : null
    }
    // A parity path is drawn at its own rate, and its captures are taken among its frames.
    clock.step = track ? 1000 / track.fps : REFRESH_MS
    const played = track
      ? await runTrack(
          rig,
          clock,
          captures && segment.capture ? track : { ...track, shots: [] },
          (i) => player.step(segment, i),
          (i) => shoot(`${slug}-f${String(i).padStart(5, '0')}`),
        )
      : null
    const frames =
      played?.frames ??
      (await runFrames(rig, clock, segment.frames, (i) => player.step(segment, i)))
    player.end(segment)
    const shots = (played?.shots ?? []).filter((shot) => shot !== null)
    // A capture the path asked for and the canvas could not give is no silent gap in the comparison.
    if (track && captures && segment.capture && shots.length !== track.shots.length)
      throw new Error(
        `BENCH_PARITY: ${segment.name}: ${shots.length} of ${track.shots.length} captures taken`,
      )
    const image = track ? (shots[0] ?? null) : await shoot(slug)
    const numbers = roundNumbers(frames)
    const bench = benchPasses(frames)
    segments.push({
      name: segment.name,
      measured: segment.measure !== false,
      numbers,
      passes: passTimes(frames),
      benchPasses: bench,
      doubts: timerDoubts({
        passes: bench,
        frame: numbers.gpuMs,
        engineFrame: numbers.engineFrameGpuMs,
      }),
      counts: countsPerFrame(frames),
      image,
      shots: shots.map((shot) => shot.path),
      taaFormats: { ...gpu.held.formats },
    })
    for (let i = 0; i < 3; i++) unit.push(await calibration.time())
  }
  const cpu = stopProfile ? functionTimes(await stopProfile()).slice(0, 60) : null
  const cpuSteps = options.cpuProfile ? world.cpuSteps() : null
  const busyAfter = await gpuBusy()
  calibration.destroy()
  closing = true
  world.dispose()
  const calibrationMs = spread(unit)!
  return {
    bench: {
      page: options.name,
      title: page.title,
      scenario: scenario.name,
      switches: options.switches,
      engine: options.engine.root,
      commit: options.engine.commit,
      subject: options.engine.subject,
      dirty: options.engine.dirty.length,
      date: new Date().toISOString(),
      gpu: gpu.held.adapter,
      features: { adapter: gpu.held.adapterFeatures, device: [...device.features].sort() },
      node: process.version,
      profile: options.profileName,
      featuresOff: options.featuresOff,
      display: options.display,
      scale: options.scale,
    },
    gpuBusy: { before: busyBefore, after: busyAfter },
    readySeconds,
    calibration: {
      ...calibrationMs,
      gbPerSecond: (2 * CALIBRATION_BYTES) / calibrationMs.median / 1e6,
    },
    machine,
    dissect: dissectModules(dissectSpec()?.pass ?? '\0'),
    segments,
    cpu,
    cpuSteps,
    engine,
    errors,
  }
}

export type BenchPlay = Awaited<ReturnType<typeof playScenario>>
