/**
 * What the core lends the impostor family (#1335, #1336, #1527): the shared sprite basis, card bit,
 * pixel scale and diagnostics, the tile pool's reads, group and feedback the cards read their maps
 * through, and the surfaces, depth, visibility targets, view, attachments, validation scope and
 * pipeline build of the card passes, in one record. `loadImpostorCode` hands it to the family when
 * it arrives (`../../impostor/borrowed.ts`), and the family reads its types alone: imported by it,
 * these core modules would be shared by its chunk and split the CDN core into more chunks, which
 * gzip worse (`check-bundle-size.ts`).
 */
import { VIS_CARD_BASE } from '../../visibility/visWords.ts'
import { markCard, SPRITE_WGSL } from '../../visibility/shader/spriteWgsl.ts'
import { focalPixels } from '../../../../math/src/projection/camera.ts'
import { grownLength } from '../../../../math/src/sequence/resized.ts'
import {
  cardTileEntries,
  cardTileLayoutEntries,
  cardTileResources,
  cardTileWgsl,
} from '../tile/cardReads.ts'
import { createCardHold } from '../tile/cardTiles.ts'
import { sendEngineDiagnostic } from '../../diagnostic/engineDiagnostic.ts'
import { SURFACE_FORMATS } from '../../scene/surfaceBuffer.ts'
import { FEEDBACK_FORMAT } from '../../scene/targetFormats.ts'
import { EMISSIVE_AO_SURFACE_FLAG } from '../../scene/surfaceModel.ts'
import { DEPTH_CLEAR } from '../../camera/depthConvention.ts'
import { VIS_DEPTH, VIS_TARGETS, scoped } from '../visibility/pipelines.ts'
import { buildRenderPipeline } from '../../lighting/deferred/fullscreen.ts'
import { viewProj } from '../pages/helpers.ts'
import { cardColorAttachments } from '../pages/prepare/attachments.ts'
import { createDenseKeySet } from '../cut/denseKeys.ts'
import { createChangedRuns } from '../residency/ranges.ts'
import { writeRanges } from '../../gpu/dag/runWrites.ts'
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
import { retire } from '../../gpu/core/frameRetire.ts'

export const impostorLent = {
  VIS_CARD_BASE,
  markCard,
  SPRITE_WGSL,
  focalPixels,
  grownLength,
  cardTileEntries,
  cardTileLayoutEntries,
  cardTileResources,
  cardTileWgsl,
  createCardHold,
  sendEngineDiagnostic,
  SURFACE_FORMATS,
  FEEDBACK_FORMAT,
  EMISSIVE_AO_SURFACE_FLAG,
  DEPTH_CLEAR,
  VIS_DEPTH,
  VIS_TARGETS,
  scoped,
  buildRenderPipeline,
  viewProj,
  cardColorAttachments,
  createDenseKeySet,
  createChangedRuns,
  writeRanges,
  createWebgpuBindIdentity,
  retire,
}
