// the two linear searches of the streaming path.
import { createJobHeap } from '../../../packages/sdk-browser/src/streaming/queueOrder.ts'
import { pushPending } from '../../../packages/sdk-browser/src/world/render/draw.ts'
import type { Job } from '../../../packages/sdk-browser/src/streaming/types.ts'
import { xorshiftRandom, measure, stress, rapport } from '../../core/index.ts'
import {
  referencePushPending,
  referenceRetireDeLaFile,
} from '../../oracles/browser/streaming-lookups.ts'

function rafale(total: number, annulations: number, depart: number) {
  const alea = xorshiftRandom(depart)
  const urls: string[] = []
  for (let i = 0; i < total; i++) urls.push(`pages/${i}-${Math.floor(alea() * 1e6)}.bin`)
  const vises: number[] = []
  for (let i = 0; i < annulations; i++) vises.push(Math.floor(alea() * Math.max(1, total)))
  return { urls, vises }
}

/** Fields a queue's order and cancellation walk never read: shared across every fixture job. */
const DUMMY_STOP = new AbortController()
const DUMMY_PROMISE = Promise.resolve(new Uint8Array())
const noop = () => {}
const file = ({ urls }: { urls: string[] }): Job[] =>
  urls.map((url, order) => ({
    url,
    priority: 0,
    order,
    bytes: 0,
    slot: -1,
    stop: DUMMY_STOP,
    state: 'queued',
    askers: 0,
    promise: DUMMY_PROMISE,
    resolve: noop,
    reject: noop,
  }))

function passeReference({ urls, vises }: { urls: string[]; vises: number[] }) {
  const queue = file({ urls })
  const cibles = vises.map((rang) => queue[rang % Math.max(1, queue.length)]).filter(Boolean)
  for (const job of cibles) referenceRetireDeLaFile(queue, job)
  return queue.map((job) => job.url)
}

function optimisedPass({ urls, vises }: { urls: string[]; vises: number[] }) {
  const queue = file({ urls })
  const heap = createJobHeap<Job>()
  for (const job of queue) heap.push(job)
  const cibles = vises.map((rang) => queue[rang % Math.max(1, queue.length)]).filter(Boolean)
  for (const job of cibles) heap.remove(job)
  const left: string[] = []
  for (let job = heap.first(Infinity); job; job = heap.first(Infinity)) {
    heap.remove(job)
    left.push(job.url)
  }
  return left
}

function adresses(total: number, depart: number) {
  const alea = xorshiftRandom(depart)
  const output: string[] = []
  for (let i = 0; i < total; i++)
    output.push(
      alea() < 0.3 && output.length ? output[Math.floor(alea() * output.length)] : `p/${i}.bin`,
    )
  return output
}

const resG5 = await measure({
  name: 'removing a cancelled request from the queue',
  fichier: 'packages/sdk-browser/src/streaming/queueOrder.ts',
  cas: [
    { name: '4 000 jobs, 2 000 cancellations', input: rafale(4000, 2000, 0x51), size: 4000 },
    { name: '4 000 jobs, one cancellation', input: rafale(4000, 1, 0x52), size: 4000 },
  ],
  calculation: optimisedPass,
  expected: passeReference,
  options: { tours: 40, budgetMs: 1500 },
})

const urlsEmpilees = adresses(4000, 0x61)
const resG6 = await measure({
  name: 'pending stack',
  fichier: 'packages/sdk-browser/src/world/render/draw.ts',
  cas: [{ name: '4 000 addresses to stack', input: urlsEmpilees, size: 4000 }],
  calculation: (urls: readonly string[]) => {
    const set = new Set<string>()
    pushPending(set, urls)
    return [...set]
  },
  expected: (urls: readonly string[]) => {
    const arr: string[] = []
    referencePushPending(arr, urls)
    return arr
  },
  options: { tours: 100, budgetMs: 1500 },
})

await stress({
  name: 'job heap extremes',
  calculation: (q: Job[]) => {
    const heap = createJobHeap<Job>()
    for (const job of q) heap.push(job)
    return heap.first(Infinity)
  },
  extremes: [{ name: 'empty', input: [] }],
})

rapport(
  'recherches-streaming',
  [resG5, resG6],
  'G5 and G6 remove and stack the exact same addresses',
)
