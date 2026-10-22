import type { ReflectionFrameMetrics } from '../../../../sdk-core/src/contracts/reflectionMetrics.ts'
import { createReadbackRing } from '../../gpu/core/readbackRing.ts'
import { RAY_TRIANGLES } from '../bounce/runtime/runtimeLayout.ts'
import {
  REFLECTION_CENSUS,
  REFLECTION_CENSUS_WORDS,
  REFLECTION_FATES,
  REFLECTION_WORK_BUCKETS,
  type ReflectionFate,
} from './censusWgsl.ts'
import { REFLECTION_COUNTS } from './constants.ts'

/** The bytes of a view's census buffer (its staging ring maps apart). */
export const REFLECTION_CENSUS_BYTES = REFLECTION_CENSUS_WORDS * 4

/** Censuses in flight at once: an image whose buffers are all in flight counts nothing, never waits. */
const IN_FLIGHT = 3

/** The metrics before any census came back: the budget the walks are spent against, every count
 *  unknown. */
const WAITING: ReflectionFrameMetrics = {
  proxyUnits: REFLECTION_COUNTS.REFLECTION_PROXY_WORK,
  proxyTriangles: RAY_TRIANGLES,
  censusReads: null,
  censusFrame: null,
  rays: null,
  farRays: null,
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
    rays: words[at.rays],
    farRays: words[at.far],
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
    },
    proxyWork: Array.from(words.subarray(at.work, at.work + REFLECTION_WORK_BUCKETS)),
  }
}

/**
 * THE REFLECTIONS' COUNTERS (`censusWgsl.ts`): the buffer both ray stages of the trace add to, cleared
 * before an image's trace and copied after it to a staging buffer of a ring, which maps once the image
 * is submitted, a few images late. No image waits: when the ring's buffers are all in flight, that
 * image counts nothing. `metrics` is the last census that came back, the same object until the next
 * one does.
 */
export function createReflectionCensus(device: GPUDevice) {
  const buffer = device.createBuffer({
    label: 'Trillion3D reflection census',
    size: REFLECTION_CENSUS_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  const words = new Uint32Array(REFLECTION_CENSUS_WORDS)
  let reads = 0,
    frame = 0,
    shownReads = 0,
    shown = WAITING,
    staging: GPUBuffer | undefined
  const ring = createReadbackRing(
    device,
    {
      label: 'Trillion3D reflection census readback',
      bytes: REFLECTION_CENSUS_BYTES,
      count: IN_FLIGHT,
    },
    (mapped, _buffer, counted) => {
      words.set(new Uint32Array(mapped, 0, REFLECTION_CENSUS_WORDS))
      frame = counted
      reads++
    },
  )
  return {
    buffer,
    /** Image `image` counts if a staging buffer is free; its copy (`copy`) follows its trace. */
    begin(image: number) {
      staging = ring.take(image)
    },
    /** The counters emptied, before the image's trace. */
    clear: (encoder: GPUCommandEncoder) => encoder.clearBuffer(buffer),
    /** The counts copied to the staging buffer `begin` took, after the trace. */
    copy(encoder: GPUCommandEncoder) {
      if (staging) encoder.copyBufferToBuffer(buffer, 0, staging, 0, REFLECTION_CENSUS_BYTES)
      staging = undefined
    },
    /** After the image's submit: its copy maps. */
    submitted: () => ring.submitted(),
    /** What the last census that came back counted; no count before the first. */
    metrics(): ReflectionFrameMetrics {
      if (shownReads !== reads) {
        shown = countedBy(words, reads, frame)
        shownReads = reads
      }
      return shown
    },
    dispose() {
      ring.destroy()
      buffer.destroy()
    },
  }
}
export type ReflectionCensus = ReturnType<typeof createReflectionCensus>
