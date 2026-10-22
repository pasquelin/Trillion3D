import { BUDGET_COLOUR, CPU_COLOUR, GPU_COLOUR } from './style.ts'

/** Values the sparkline holds: a report a quarter of a second, half a minute. */
const SPARK = 120

/**
 * The sparkline of the last reports' CPU and GPU times on `spark`, against the refresh budget:
 * the panel pushes the two times of each report into fixed rings, then draws. The canvas's size is
 * read when it is resized (`ResizeObserver`), never on a draw; where the browser has no observer
 * it is read on each draw; a resize draws again with the last budget. Returns `push`, `draw` and
 * what stops it.
 */
export function sparkline(spark: HTMLCanvasElement) {
  const gpuRing = new Float32Array(SPARK).fill(NaN),
    cpuRing = new Float32Array(SPARK).fill(NaN)
  let head = 0,
    ratio = 1,
    width = 0,
    height = 0,
    lastBudgetMs: number | null = null,
    context: CanvasRenderingContext2D | null = null
  const measure = () => {
    ratio = globalThis.devicePixelRatio || 1
    width = Math.round(spark.clientWidth * ratio)
    height = Math.round(spark.clientHeight * ratio)
  }
  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          measure()
          if (lastBudgetMs !== null) draw(lastBudgetMs)
        })
  observer?.observe(spark)

  const LINES = [
    [cpuRing, CPU_COLOUR],
    [gpuRing, GPU_COLOUR],
  ] as const
  const draw = (budgetMs: number) => {
    lastBudgetMs = budgetMs
    if (!observer) measure()
    if (!width || !height) return
    if (spark.width !== width) spark.width = width
    if (spark.height !== height) spark.height = height
    context ??= spark.getContext('2d')
    if (!context) return
    let top = budgetMs * 2
    for (let i = 0; i < SPARK; i++) {
      if (gpuRing[i] > top) top = gpuRing[i]
      if (cpuRing[i] > top) top = cpuRing[i]
    }
    top = Math.min(top * 1.1, 100)
    const y = (value: number) => height - (value / top) * (height - ratio) - ratio * 0.5
    const line = Math.round(y(budgetMs)) + 0.5
    context.clearRect(0, 0, width, height)
    context.fillStyle = 'rgba(255,255,255,.05)'
    context.fillRect(0, y(budgetMs), width, height - y(budgetMs))
    context.strokeStyle = BUDGET_COLOUR
    context.lineWidth = ratio
    context.setLineDash([3 * ratio, 3 * ratio])
    context.beginPath()
    context.moveTo(0, line)
    context.lineTo(width, line)
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
    push(cpuMs: number | null, gpuMs: number | null) {
      cpuRing[head] = cpuMs ?? NaN
      gpuRing[head] = gpuMs ?? NaN
      head = (head + 1) % SPARK
    },
    draw,
    stop() {
      observer?.disconnect()
    },
  }
}
