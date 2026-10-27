import type { ReflectionFrameMetrics } from '../../../../sdk-core/src/contracts/reflectionMetrics.ts'
import { createReadbackRing } from '../../gpu/core/readbackRing.ts'
import { REFLECTION_CENSUS_WORDS } from './censusWgsl.ts'
import { WAITING, countedBy } from './censusCount.ts'

/** The bytes of a view's census buffer (its staging ring maps apart). */
export const REFLECTION_CENSUS_BYTES = REFLECTION_CENSUS_WORDS * 4

/** Censuses in flight at once: an image whose buffers are all in flight counts nothing, never waits. */
const IN_FLIGHT = 3

/** What the census keeps between images: the censuses that came back and the image the last counted, the metrics
 *  shown for them, whether the view traces this image and whether its scene stage marched its rays through the field (`countedBy`). */
interface CensusState {
  reads: number
  frame: number
  shownReads: number
  shown: ReflectionFrameMetrics
  tracing: boolean
  marched: boolean
  shownMarched: boolean
}

/** What the last census that came back counted: the same object until the next one does; null while the view
 *  traces nothing. */
function metricsOf(state: CensusState, words: Uint32Array): ReflectionFrameMetrics | null {
  if (!state.tracing) return null
  const { reads } = state
  if (state.shownReads !== reads || state.shownMarched !== state.marched) {
    state.shown = reads ? countedBy(words, reads, state.frame, state.marched) : WAITING
    state.shownReads = reads
    state.shownMarched = state.marched
  }
  return state.shown
}

/** What a view's census offers the frame: its buffer (none where nothing is counted), the calls of an image, the metrics. */
export interface ReflectionCensus {
  buffer: GPUBuffer | undefined
  idle(): void
  clear(encoder: GPUCommandEncoder): void
  copy(encoder: GPUCommandEncoder, image: number, marched?: boolean): void
  submitted(): void
  metrics(): ReflectionFrameMetrics | null
  dispose(): void
}

/** The census of a view that counts nothing (`reflectionStatistics` off): no buffer, no ring, every call a no-op, no metrics. */
const NO_CENSUS: ReflectionCensus = {
  buffer: undefined,
  idle() {},
  clear() {},
  copy() {},
  submitted() {},
  metrics: () => null,
  dispose() {},
}

/**
 * THE REFLECTIONS' COUNTERS (`censusWgsl.ts`), where the project asks for them (`statistics`, `reflectionStatistics`, off by
 * default: the kernels are then compiled without the counting and nothing here is made): the buffer both ray stages of the
 * trace add to, cleared
 * before an image's trace and copied after it to a staging buffer of a ring, which maps once the image
 * is submitted, a few images late. No image waits: when the ring's buffers are all in flight, that
 * image counts nothing. `metrics` is the last census that came back, the same object until the next
 * one does, and `null` while the view traces nothing: an image that traces says so with its copy
 * (`copy`), every image first says it does not (`idle`).
 */
export function createReflectionCensus(device: GPUDevice, statistics: boolean): ReflectionCensus {
  if (!statistics) return NO_CENSUS
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
    tracing: false,
    marched: true,
    shownMarched: true,
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
     *  after its trace; `marched`, whether its scene stage marched its rays through the field (the default), the metrics then holding how they ended. */
    copy(encoder: GPUCommandEncoder, image: number, marched = true) {
      state.tracing = true
      state.marched = marched
      const staging = ring.take(image)
      if (staging) encoder.copyBufferToBuffer(buffer, 0, staging, 0, REFLECTION_CENSUS_BYTES)
    },
    /** After the image's submit: its copy maps. */
    submitted: () => ring.submitted(),
    metrics: () => metricsOf(state, words),
    dispose() {
      ring.destroy()
      buffer.destroy()
    },
  }
}
