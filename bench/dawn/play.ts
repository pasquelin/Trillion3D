// One play of a scenario on its page, in this process: the page opened as the browser opens it,
// warmed until its images are timed, then each segment played and measured on its own.
import { createCalibration, CALIBRATION_BYTES } from './calibration.ts'
import { captureCanvas } from './capture.ts'
import { functionTimes, startCpuProfile } from './cpuProfile.ts'
import { installGpu } from './device.ts'
import { installBrowser } from './dom.ts'
import { createClock, runFrames, warmUp } from './frames.ts'
import { gpuBusy } from './gpuBusy.ts'
import type { BenchOptions } from './options.ts'
import { pageAddress, readPage, runPage } from './page.ts'
import { createPlayer } from './scenario.ts'
import { benchPasses } from './benchPasses.ts'
import { timerDoubts } from './trust.ts'
import { countsPerFrame, passTimes, roundNumbers, spread } from './summary.ts'

/** Plays `options.scenario` once; `stem` names its images. Resolves to the play's numbers. */
export async function playScenario(options: BenchOptions, stem: string) {
  const { scenario } = options
  const busyBefore = await gpuBusy()
  const gpu = installGpu({ limits: options.profile.limits, featuresOff: options.featuresOff })
  const page = readPage(options.file)
  const address = pageAddress(options.file, options.engine.root, options.search)
  const browser = installBrowser(options.display, address, page.canvasIds, page.elementIds)
  // The profiled play times the CPU alone: it captures nothing, its encoding would be profiled.
  const captures = !options.cpuProfile && scenario.segments.some((segment) => segment.capture)
  for (const canvas of browser.canvases) canvas.readable = captures
  const errors: string[] = []
  const opened = performance.now()
  const [world] = await runPage(options.file, options.engine.root, page.scripts)
  if (!world) throw new Error(`BENCH_PAGE: ${options.name} made no world`)
  if (options.scale !== 'page') world.renderScale = Number(options.scale)
  const clock = createClock()
  const rig = { browser, gpu, world }
  // The device is the engine's own, asked when its session opens: frames run until it submits.
  const deadline = performance.now() + options.timeoutS * 500
  while (!gpu.held.device) {
    if (performance.now() > deadline)
      throw new Error('BENCH_DEVICE: the engine submitted nothing to a GPU device')
    browser.frame(clock.time)
    await new Promise((done) => setTimeout(done, 1))
  }
  const device = gpu.held.device
  device.addEventListener('uncapturederror', (event) => {
    errors.push(String((event as GPUUncapturedErrorEvent).error.message).slice(0, 400))
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
    process.exit(4)
  })
  const calibration = await createCalibration(gpu, device)
  await warmUp(rig, clock, options.timeoutS * 500, 8)
  await runFrames(rig, clock, options.warm)
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
    const frames = await runFrames(rig, clock, segment.frames, (i) => player.step(segment, i))
    player.end(segment)
    const texture = (browser.canvases[0].getContext('webgpu') as { current: GPUTexture | null })
      .current
    const image =
      captures && segment.capture && texture
        ? await captureCanvas(
            gpu,
            device,
            texture,
            `${stem}-${segment.name.replace(/\W+/g, '-')}.png`,
          )
        : null
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
    segments,
    cpu,
    cpuSteps,
    engine,
    errors,
  }
}

export type BenchPlay = Awaited<ReturnType<typeof playScenario>>
