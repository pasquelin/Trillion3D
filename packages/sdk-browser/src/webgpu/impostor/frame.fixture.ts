// The WebGPU runtime the impostor frame tests plan and draw on (`frame.test.ts`): reduced to what the
// plan and the card pass read, on a recording device, the tile pool's card residency a stand-in
// whose maps a test lands (`land`).
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createEngineCamera } from '../../camera/engineCamera.ts'
import type { CardAsk, CardTiles } from '../tile/cardTiles.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { prepareImpostorPipelines } from './pipelines.ts'
import { MESH, VIEWPORT, impostorScene, impostorSection } from '../../impostor/section.fixture.ts'

/** The slots of the fixture mesh's maps, and of a second mesh's, in the tile atlases. */
export const TILES: CardTiles = [5, 6, 7]
const OTHER_TILES: CardTiles = [8, 9, 10]

/** A WebGPU runtime reduced to what the plan and the card pass read, on a recording device whose
 *  card pipelines its prepare checked. Its maps reside once `land` is called; each ask they
 *  answered is kept. */
export async function bench() {
  const gpu = fakeDevice()
  assert.ok(await prepareImpostorPipelines(gpu.device, () => {}))
  const { fixture, roots } = impostorScene()
  const marked: Array<[number, number]> = [],
    asks: Array<CardAsk & { tiles: CardTiles }> = []
  let resident = false
  const cards = {
    count: 2,
    tilesOf: (mesh: number) => [TILES, OTHER_TILES][mesh - MESH],
    ready(tiles: CardTiles, ask: CardAsk) {
      asks.push({ ...ask, tiles })
      return resident
    },
    release() {},
  }
  const atlas = (kind: string) => ({
    views: [0, 1, 2].map((lane) => ({ label: `${kind} pool ${lane}` })),
    pages: { buffer: { label: `${kind} pages` } },
  })
  const rt = {
    context: { metadata: { impostors: impostorSection } },
    vis: {
      visView: { label: 'ids' },
      mapsSampler: { label: 'maps' },
      writesFeedback: true,
      textures: {
        cards,
        color: atlas('color'),
        data: atlas('data'),
        feedback: { phaseWord: () => 0 },
      },
    },
    setup: { viewport: VIEWPORT },
    layout: { selectionRoots: roots },
    diag: { diagnosticFailure: () => undefined },
    gpu: {
      device: gpu.device,
      impostors: undefined,
      targetSize: VIEWPORT,
      depthView: { label: 'depth' },
      feedbackView: { label: 'feedback' },
      surfaces: { views: () => [0, 1, 2, 3].map((label) => ({ label })) },
    },
    run: {
      frame: 0,
      feedbackWritten: true,
      gate: { resourcesChanged: () => undefined, cam: createEngineCamera() },
      gpuDrawCalls: 0,
      gpuSelection: {
        markWorld: (rank: number, mark: number) => marked.push([rank, mark]),
        worldStandsIn: () => false,
      },
    },
  } as unknown as WebgpuPagesRuntime
  return {
    gpu,
    rt,
    roots,
    fixture,
    marked,
    asks,
    /** The maps' tiles reside from now on, or leave (`false`). */
    land: (now = true) => void (resident = now),
  }
}
