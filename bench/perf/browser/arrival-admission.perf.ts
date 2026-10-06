// transfer admission and draining arrivals.
import {
  findAdmissible,
  insereTravail,
} from '../../../packages/sdk-browser/src/streaming/queueOrder.ts'
import type { Job } from '../../../packages/sdk-browser/src/streaming/types.ts'
import { createArrivalQueue } from '../../../packages/sdk-browser/src/page/integration/arrivalQueue.ts'
import { createFrameBudget } from '../../../packages/sdk-browser/src/page/integration/frameBudget.ts'
import { xorshiftRandom, measure, stress, rapport } from '../../core/index.ts'
import {
  referenceAdmission,
  referenceArrivalQueue,
} from '../../oracles/browser/arrival-admission.ts'

/** The frame budget the engine's queue spends, opened before each drain as a frame opens it: no
 *  ceiling, like the oracle it is compared with, so the two deliver alike on any machine. */
const frame = createFrameBudget(Infinity)

/** The fields `insereTravail`/`findAdmissible` read: a lighter shape than the engine's `Job`. */
interface AdmissionJob {
  url: string
  priority: number
  order: number
  consumers: number
}

const ACTIVE_LIMIT = 6,
  TRANSFER_BUDGET = 2 * 1024 * 1024
/**
 * The engine's admission, as `streaming/queue.ts`'s pump runs it: the queue is already in order —
 * each job went in by `insereTravail` —, so no sort; the first admissible job leaves by `splice`.
 * The pump itself needs a live transfer context; this is its loop, on the engine's functions.
 */
function engineAdmission(queue: AdmissionJob[], bytesOf: (url: string) => number | undefined) {
  const admitted: string[] = []
  let active = 0,
    activeBytes = 0
  while (active < ACTIVE_LIMIT && queue.length) {
    const at = findAdmissible(queue, active, activeBytes, bytesOf, TRANSFER_BUDGET)
    if (at < 0) break
    const job = queue.splice(at, 1)[0]
    if (job.consumers === 0) continue
    active++
    activeBytes += bytesOf(job.url) ?? 0
    admitted.push(job.url)
  }
  return admitted
}

const random = xorshiftRandom(71)
const catalogue = new Map<string, number>()
const jobs: AdmissionJob[] = []
for (let i = 0; i < 5000; i++) {
  const url = `page-${i % 4200}.bin`
  catalogue.set(url, Math.floor(random() * 400 * 1024))
  jobs.push({ url, priority: (i * 7) % 5, order: i, consumers: i % 97 ? 1 : 0 })
}
const bytesOf = (url: string) => catalogue.get(url)
/** The same jobs in the order the engine keeps them: each inserted at its slot as it arrives. */
const inOrder: AdmissionJob[] = []
for (const job of jobs) insereTravail(inOrder as unknown as Job[], job as unknown as Job)
/** The queue an admission consumes, refilled in place before each call: no array allocated. */
const consumed: AdmissionJob[] = []
const refill = (from: readonly AdmissionJob[]) => {
  consumed.length = 0
  for (let i = 0; i < from.length; i++) consumed.push(from[i])
  return consumed
}
const admissions = { full: { inOrder, arrival: jobs }, empty: { inOrder: [], arrival: [] } }
type Admission = (typeof admissions)['full']

/** What `createArrivalQueue`/`referenceArrivalQueue` both build: `queue`/`drain` on the same shape. */
interface QueueFactory {
  queue(
    target: { acceptPage(url: string, array: Uint32Array): void },
    url: string,
    array: Uint32Array,
  ): unknown
  drain(): number
}

function arrivals(factory: (byteBudget: number, countBudget: number) => QueueFactory) {
  const delivered: string[] = []
  const targets: { acceptPage(url: string): void }[] = []
  for (let c = 0; c < 8; c++)
    targets.push({
      acceptPage: (url: string) => delivered.push(`${c}:${url}`),
    })
  const queue = factory(64 * 1024 * 1024, 4096)
  const bytes = new Uint32Array(16)
  for (let i = 0; i < 5000; i++) queue.queue(targets[i % 8], `page-${i % 900}.bin`, bytes)
  let drained = 0
  for (let d = 0; d < 4; d++) {
    frame.open()
    drained += queue.drain()
  }
  return { delivered, drained }
}

const resAdmission = await measure({
  name: 'admission streaming',
  fichier: [
    'packages/sdk-browser/src/streaming/queueOrder.ts',
    'packages/sdk-browser/src/streaming/queue.ts',
  ],
  cas: [
    { name: '5 000 ordered jobs', input: admissions.full, size: 5000 },
    { name: 'no jobs', input: admissions.empty as Admission, size: 0 },
  ],
  // The oracle sorts its own copy of the queue in arrival order, as the code did.
  calculation: ({ inOrder: queue }: Admission) => engineAdmission(refill(queue), bytesOf),
  expected: ({ arrival }: Admission) => referenceAdmission(arrival.slice(), bytesOf),
  options: { tours: 100, budgetMs: 1500 },
})

const resArrivals = await measure({
  name: 'arrival queue',
  fichier: 'packages/sdk-browser/src/page/integration/arrivalQueue.ts',
  cas: [{ name: '5 000 arrivals on 8 targets', input: null, size: 5000 }],
  calculation: () => arrivals((bytes, count) => createArrivalQueue(bytes, count, frame)),
  expected: () => arrivals(referenceArrivalQueue),
  options: { tours: 60, budgetMs: 1500 },
})

await stress({
  name: 'createArrivalQueue extremes',
  calculation: (size: number) => createArrivalQueue(size, 4096, frame),
  extremes: [
    { name: 'small', input: 4096 },
    { name: 'large', input: 1 << 28 },
  ],
})

rapport(
  'admission-arrivees',
  [resAdmission, resArrivals],
  'A12 admits and delivers the exact same pages',
)
