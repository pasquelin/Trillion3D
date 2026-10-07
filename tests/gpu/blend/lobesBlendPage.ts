// The engine side of the transparent lobes proof (`lobes.gpu.ts`): the plane of the opaque lobes
// proofs (`../visibility/physicalLobesPage.ts`), blended — a transparent surface the blend pass
// lights in place, its lobes set by its own fragment (`physicalWgsl.ts`) —, rendered by the real
// WebGPU engine until held.
import type * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { runOnDevice as withDevice } from '../kit/deviceProof.ts'
import {
  ANISOTROPY_CASES,
  CLEARCOAT_CASES,
  readCases,
  type LobeReading,
} from '../visibility/physicalLobesPage.ts'

/** Each case's blended plane, read as the opaque proofs read theirs. */
const blended = (cases: Record<string, G.SurfaceParameters>) =>
  withDevice<{ readings: Record<string, LobeReading> }>((device, events, result) =>
    readCases(device, events, result, cases, { blend: true }),
  )

/** The clear coat over a blended matte base: none, a sharp coat, and a coat its map zeroes. */
export const clearcoat = () => blended(CLEARCOAT_CASES)

/** The anisotropic lobe of a blended metal: none, along the tangent, turned a quarter, and a
 *  strength map at zero. */
export const anisotropy = () => blended(ANISOTROPY_CASES)
