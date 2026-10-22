import type { ReflectionFrameMetrics } from '../../../../sdk-core/src/contracts/reflectionMetrics.ts'
import { createReadbackRing } from '../../gpu/core/readbackRing.ts'
import {
  REFLECTION_CENSUS,
  REFLECTION_CENSUS_WORDS,
  REFLECTION_FATES,
  REFLECTION_WORK_BUCKETS,
  type ReflectionFate,
} from './censusWgsl.ts'

/** The bytes of a view's census buffer (its staging ring maps apart). */
export const REFLECTION_CENSUS_BYTES = REFLECTION_CENSUS_WORDS * 4

/** Censuses in flight at once: an image whose buffers are all in flight counts nothing, never waits. */
const IN_FLIGHT = 3

/** The metrics before any census came back: every count unknown, the budget the walks are spent against
 *  (`budget`) laid over them (`metrics`). */
const WAITING: ReflectionFrameMetrics = {
  proxyUnits: 0,
  proxyTriangles: 0,
  censusReads: null,
  censusFrame: null,
  rays: null,
  screenRays: null,
  screenWholeRays: null,
  sceneRays: null,
  proxyEnded: null,
  proxyWork: null,
}

/** The metrics a census `words` of image `frame` gives, `reads` the censuses that came back. */
function countedBy(words: Uint32Array, reads: number, frame: number): ReflectionFrameMetrics {
  const at = REFLECTION_CENSUS
  const fate = (name: ReflectionFate) => words[at.fates + REFLECTION_FATES.indexOf(name)]
  return {
    ...WAITING,
    censusReads: reads,
    censusFrame: frame,
    // Every ray the screen stage casts ends in exactly one of these two.
    rays: words[at.whole] + words[at.left],
    screenRays: words[at.screen],
    screenWholeRays: words[at.whole],
    sceneRays: words[at.left],
    proxyEnded: {
      noProxy: fate('noProxy'),
      work: fate('work'),
      tests: fate('tests'),
      tree: fate('tree'),
      mesh: fate('mesh'),
      hit: fate('hit'),
      open: fate('open'),
      miss: fate('miss'),
      bound: fate('bound'),
      distant: fate('distant'),
    },
    proxyWork: Array.from(words.subarray(at.work, at.work + REFLECTION_WORK_BUCKETS)),
  }
}

/** What the census keeps between images: the censuses that came back and the image the last counted, the metrics
 *  shown for them, the budget the rays are spent against, and whether the view traces this image. */
interface CensusState {
  reads: number
  frame: number
  shownReads: number
  shown: ReflectionFrameMetrics
  units: number
  tests: number
  tracing: boolean
}

/** What the last census that came back counted, with the budget laid over it: the same object until the next one
 *  does or the budget moves; null while the view traces nothing. */
function metricsOf(state: CensusState, words: Uint32Array): ReflectionFrameMetrics | null {
  if (!state.tracing) return null
  const { shown, units, tests, reads } = state
  if (state.shownReads !== reads || shown.proxyUnits !== units || shown.proxyTriangles !== tests) {
    state.shown = {
      ...(reads ? countedBy(words, reads, state.frame) : WAITING),
      proxyUnits: units,
      proxyTriangles: tests,
    }
    state.shownReads = reads
  }
  return state.shown
}

/**
 * THE REFLECTIONS' COUNTERS (`censusWgsl.ts`): the buffer both ray stages of the trace add to, cleared
 * before an image's trace and copied after it to a staging buffer of a ring, which maps once the image
 * is submitted, a few images late. No image waits: when the ring's buffers are all in flight, that
 * image counts nothing. `metrics` is the last census that came back, the same object until the next
 * one does, and `null` while the view traces nothing: an image that traces says so with its copy
 * (`copy`), every image first says it does not (`idle`).
 */
export function createReflectionCensus(device: GPUDevice) {
  const buffer = device.createBuffer({
    label: 'Trillion3D reflection census',
    size: REFLECTION_CENSUS_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  const words = new Uint32Array(REFLECTION_CENSUS_WORDS)
  const state: CensusState = {
    reads: 0,
    frame: 0,
    shownReads: 0,
    shown: WAITING,
    units: 0,
    tests: 0,
    tracing: false,
  }
  const ring = createReadbackRing(
    device,
    {
      label: 'Trillion3D reflection census readback',
      bytes: REFLECTION_CENSUS_BYTES,
      count: IN_FLIGHT,
    },
    (mapped, _buffer, counted) => {
      words.set(new Uint32Array(mapped, 0, REFLECTION_CENSUS_WORDS))
      state.frame = counted
      state.reads++
    },
  )
  return {
    buffer,
    /** The image being encoded traces nothing, until its trace's copy (`copy`) says it does. */
    idle() {
      state.tracing = false
    },
    /** The counters emptied, before the image's trace. */
    clear: (encoder: GPUCommandEncoder) => encoder.clearBuffer(buffer),
    /** The image `image` traced: its counts copied to a staging buffer of the ring, if one is free,
     *  after its trace. */
    copy(encoder: GPUCommandEncoder, image: number) {
      state.tracing = true
      const staging = ring.take(image)
      if (staging) encoder.copyBufferToBuffer(buffer, 0, staging, 0, REFLECTION_CENSUS_BYTES)
    },
    /** After the image's submit: its copy maps. */
    submitted: () => ring.submitted(),
    /** The budget of a ring's walk this image's rays are spent against, its units and its triangle tests,
     *  which `metrics` reports (`ReflectionFrameMetrics.proxyUnits`). */
    budget(units: number, tests: number) {
      state.units = units
      state.tests = tests
    },
    metrics: () => metricsOf(state, words),
    dispose() {
      ring.destroy()
      buffer.destroy()
    },
  }
}
export type ReflectionCensus = ReturnType<typeof createReflectionCensus>
