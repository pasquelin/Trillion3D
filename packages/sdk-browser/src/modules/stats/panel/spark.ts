import { BUDGET_COLOUR, CPU_COLOUR, GPU_COLOUR } from './style.ts'

/** Values the sparkline holds: a report a quarter of a second, half a minute. */
const SPARK = 120

/** The canvas's pixel box and its scale. */
interface SparkBox {
  ratio: number
  width: number
  height: number
}

/** The value at the top of the chart: twice the budget or the highest value, up to 100 ms. */
function chartTop(budgetMs: number, rings: readonly Float32Array[]) {
  let top = budgetMs * 2
  for (const ring of rings) for (let i = 0; i < SPARK; i++) if (ring[i] > top) top = ring[i]
  return Math.min(top * 1.1, 100)
}

/** The budget: the area under it and a dashed line at it; `y` maps a value to a pixel row. */
function drawBudget(
  context: CanvasRenderingContext2D,
  { ratio, width, height }: SparkBox,
  budgetMs: number,
  y: (value: number) => number,
) {
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
}

/** One ring as a line, oldest first from `head`; a gap (NaN) lifts the pen. */
function drawRing(
  context: CanvasRenderingContext2D,
  width: number,
  ring: Float32Array,
  head: number,
  y: (value: number) => number,
) {
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
    lastBudgetMs: number | null = null,
    context: CanvasRenderingContext2D | null = null
  const box: SparkBox = { ratio: 1, width: 0, height: 0 }
  const measure = () => {
    box.ratio = globalThis.devicePixelRatio || 1
    box.width = Math.round(spark.clientWidth * box.ratio)
    box.height = Math.round(spark.clientHeight * box.ratio)
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
    const { ratio, width, height } = box
    if (!width || !height) return
    if (spark.width !== width) spark.width = width
    if (spark.height !== height) spark.height = height
    context ??= spark.getContext('2d')
    if (!context) return
    const top = chartTop(budgetMs, [gpuRing, cpuRing])
    const y = (value: number) => height - (value / top) * (height - ratio) - ratio * 0.5
    drawBudget(context, box, budgetMs, y)
    context.lineWidth = 1.25 * ratio
    for (const [ring, colour] of LINES) {
      context.strokeStyle = colour
      drawRing(context, width, ring, head, y)
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
