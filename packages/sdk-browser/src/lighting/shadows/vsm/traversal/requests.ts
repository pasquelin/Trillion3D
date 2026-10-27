/**
 * THE SHADOW VIEWS' REQUESTS, TO THE ENGINE'S ONE REQUEST PATH: the descent asks for each leaf a view
 * keeps (`traversalWgsl.ts`, `requestPage`) in its readout, laid as the camera cut's
 * (`../../../../geometry/dag/readoutWords.ts`). The next frame copies the requests into a buffer of a
 * readback ring at its start, before its descent clears them (`../../../../gpu/core/readbackRing.ts`);
 * they land a few frames
 * later, never waited on, read by the cut's own reader (`parseDagOutput`), and the streaming takes
 * them beside the views' readbacks (`vsmShadowRequestCuts`, `../../../../geometry/residency/queue.ts`,
 * `queueCuts`): every streaming page a shadow view needs is asked, at the priority its category
 * gives it, below the camera's.
 */
import { createReadbackRing, type ReadbackRing } from '../../../../gpu/core/readbackRing.ts'
import { createSelectionUniforms, type GpuCut } from '../../../../gpu/core/selection.ts'
import type { ViewReadbacks } from '../../../../geometry/residency/queueState.ts'
import { copiedWords, countWord, priorityWord } from '../../../../geometry/dag/readoutWords.ts'
import { parseDagOutput } from '../../../../geometry/dag/uniforms.ts'
import type { VsmResources } from '../resources.ts'

const LABEL = 'vsm.descent.requests'
/** Copies in flight at most: one a frame, each read a few frames late. */
const IN_FLIGHT = 3

/** A set's ring of requests, and the last that landed as the streaming reads a cut's. */
interface DescentRequests {
  device: GPUDevice
  ring: ReadbackRing<number>
  landed?: GpuCut
}

/** The uniforms of the readbacks the descent hands the streaming: a block no one writes. */
const NO_UNIFORMS = createSelectionUniforms()

const requests = new WeakMap<VsmResources, DescentRequests>()
/** The set each session's shadows draw with: what the streaming reads their requests from. */
const sets = new WeakMap<object, VsmResources>()

/** The requests of a landed copy, its readout of `listCap` ranks, as a cut's readback holds them. */
function land(held: DescentRequests, mapped: ArrayBuffer, listCap: number) {
  const parsed = parseDagOutput(mapped, 0, Math.min(mapped.byteLength, 4 * copiedWords(listCap)), {
    drawn: 0,
    priorities: priorityWord(listCap),
    counts: countWord(listCap),
  })
  if (!parsed) return
  // A new object at each landing: the streaming reads a readback again when it is another.
  // The streaming reads its result's requests alone (`queueCuts`, `take`): the uniforms are the
  // blank block of a view that drew no image, and the revision the oldest, as a cut that holds none.
  held.landed = {
    uniforms: NO_UNIFORMS,
    worldRevision: 0,
    result: {
      ...parsed,
      requests: {
        pages: parsed.requests.pages.slice(),
        counts: parsed.requests.counts.slice(),
        priorities: parsed.requests.priorities.slice(),
      },
      pageIds: [],
    },
  }
}

/** The copy of the descent's readout `out` of `listCap` ranks into a buffer of the ring of `res`. */
export function encodeVsmDescentRequests(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  res: VsmResources,
  out: GPUBuffer,
  listCap: number,
) {
  let held = requests.get(res)
  if (held?.device !== device) {
    releaseVsmDescentRequests(res)
    const made: DescentRequests = {
      device,
      ring: createReadbackRing<number>(
        device,
        { label: LABEL, bytes: 4 * copiedWords(listCap), count: IN_FLIGHT },
        (mapped, _, ranks) => land(made, mapped, ranks ?? listCap),
      ),
    }
    requests.set(res, (held = made))
  }
  const bytes = 4 * copiedWords(listCap)
  const staging = held.ring.take(listCap, bytes)
  if (staging) encoder.copyBufferToBuffer(out, 0, staging, 0, bytes)
}

/** After the frame's submit: the copy maps. */
export function vsmDescentRequestsSubmitted(res: VsmResources | undefined) {
  if (res) requests.get(res)?.ring.submitted()
}

export function releaseVsmDescentRequests(res: VsmResources) {
  requests.get(res)?.ring.destroy()
  requests.delete(res)
}

/** Session `session` draws its shadows with the set `res`: the streaming reads its requests. */
export const noteVsmRequestSet = (session: object, res: VsmResources) => void sets.set(session, res)

/** The views' readbacks `handed` with the shadow views' last requests behind them, one object made
 *  again only when what it holds changed — `handed`'s list is rewritten in place —: the streaming
 *  reads a readback again when it is another. */
const merged = new WeakMap<object, ViewReadbacks>()
export function vsmShadowRequestCuts(session: object, handed: ViewReadbacks): ViewReadbacks {
  const res = sets.get(session)
  const landed = res && requests.get(res)?.landed
  if (!landed) return handed
  const held = merged.get(session)
  const same =
    held?.first === handed.first &&
    held.cuts.length === handed.cuts.length + 1 &&
    held.cuts[handed.cuts.length] === landed &&
    handed.cuts.every((cut, at) => cut === held.cuts[at])
  if (same) return held!
  const made = { cuts: [...handed.cuts, landed], first: handed.first }
  merged.set(session, made)
  return made
}
