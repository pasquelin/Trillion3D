import type { StatsWorld } from './statsLines.ts'
import { CPU_COLOUR, GPU_COLOUR } from './statsStyle.ts'

/** The 120 Hz budget, and the 60 Hz one past which the frame reads red. */
export const BUDGET_MS = 1000 / 120
const LATE_MS = 1000 / 60
/** Frames the sparkline holds. */
const SPARK = 120

/** `fps` and `ms` coloured against the budget. */
export const tone = (frameMs: number | null) =>
  frameMs == null
    ? ''
    : frameMs <= BUDGET_MS + 0.05
      ? 't3s-ok'
      : frameMs <= LATE_MS + 0.05
        ? 't3s-warn'
        : 't3s-bad'

/**
 * The sparkline of the last frames' CPU and GPU times on `spark`: a frame only writes its two
 * times into fixed rings and marks the drawing owed; `draw` paints only what is owed and only
 * while `visible()`, so a held image paints nothing. The canvas's size is read when it is
 * resized (`ResizeObserver`), never on a draw; where the browser has no observer it is read on
 * each paint that is owed. Returns `draw` and what stops it.
 */
export function sparkline(world: StatsWorld, spark: HTMLCanvasElement, visible: () => boolean) {
  const gpuRing = new Float32Array(SPARK).fill(NaN),
    cpuRing = new Float32Array(SPARK).fill(NaN)
  let head = 0,
    owed = true,
    ratio = 1,
    width = 0,
    height = 0
  const unhook = world.onFrame(({ metrics }) => {
    gpuRing[head] = metrics.gpuFrameMs ?? NaN
    cpuRing[head] = metrics.cpuFrameMs ?? NaN
    head = (head + 1) % SPARK
    owed = true
  })
  const measure = () => {
    ratio = globalThis.devicePixelRatio || 1
    width = Math.round(spark.clientWidth * ratio)
    height = Math.round(spark.clientHeight * ratio)
    owed = true
  }
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
  observer?.observe(spark)

  const LINES = [
    [cpuRing, CPU_COLOUR],
    [gpuRing, GPU_COLOUR],
  ] as const
  const draw = () => {
    if (!owed || !visible()) return
    if (!observer) measure()
    if (!width || !height) return
    owed = false
    if (spark.width !== width) spark.width = width
    if (spark.height !== height) spark.height = height
    const context = spark.getContext('2d')
    if (!context) return
    let top = LATE_MS
    for (let i = 0; i < SPARK; i++) {
      if (gpuRing[i] > top) top = gpuRing[i]
      if (cpuRing[i] > top) top = cpuRing[i]
    }
    top = Math.min(top * 1.1, 100)
    const y = (value: number) => height - (value / top) * (height - ratio) - ratio * 0.5
    context.clearRect(0, 0, width, height)
    context.fillStyle = 'rgba(255,255,255,.05)'
    context.fillRect(0, y(BUDGET_MS), width, height - y(BUDGET_MS))
    context.strokeStyle = 'rgba(255,255,255,.45)'
    context.lineWidth = ratio
    context.setLineDash([3 * ratio, 3 * ratio])
    context.beginPath()
    context.moveTo(0, Math.round(y(BUDGET_MS)) + 0.5)
    context.lineTo(width, Math.round(y(BUDGET_MS)) + 0.5)
    context.stroke()
    context.setLineDash([])
    context.lineWidth = 1.25 * ratio
    for (const [ring, colour] of LINES) {
      context.strokeStyle = colour
      context.beginPath()
      let pen = false
      for (let i = 0; i < SPARK; i++) {
        const value = ring[(head + i) % SPARK]
        if (Number.isNaN(value)) {
          pen = false
          continue
        }
        const x = (i / (SPARK - 1)) * width
        if (pen) context.lineTo(x, y(value))
        else context.moveTo(x, y(value))
        pen = true
      }
      context.stroke()
    }
  }
  return {
    draw,
    stop() {
      observer?.disconnect()
      if (typeof unhook === 'function') unhook()
    },
  }
}
