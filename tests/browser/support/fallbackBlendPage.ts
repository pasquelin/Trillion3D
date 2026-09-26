// Page side of the fallback-blend probe (#584): the real WebGPU engine on a real device, twice on
// one scene — once as the device is, once on a session handle of that device that refuses every
// render pipeline writing the visibility target, as a device without it does. The engine then
// draws with its fallback pass; nothing else differs. Four paged transparent tiles, one per mode,
// sit across a night half and a paper half; the page reads each tile over each half, and the
// background beside it, on both images.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { webgpuPagesBackend } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts';
import {
  sessionHandle,
  sessionTag,
} from '../../../packages/sdk-browser/src/gpu/core/sessionHandle.ts';
import { hostBlending } from '../../../packages/sdk-browser/src/scene/materialBlending.ts';
import type { Blending } from '../../../packages/sdk-core/src/world/constants/index.ts';
import { batisseur, cameraFace, carre, engine, libere } from './sharedSceneProof.ts';
import { difference, image } from './sceneImageProof.ts';
import { executerAppareil } from './deviceProof.ts';
import { project } from '../probes/cameraRig.ts';

export const MODES: readonly Blending[] = ['normal', 'additive', 'subtractive', 'multiply'];
/** Where each tile's row sits, top to bottom, and the half-size of a tile. */
const RANGEES = [0.9, 0.3, -0.3, -0.9],
  DEMI = 0.25;
/** Night on the left, paper on the right, read a quarter tile from the seam. */
const COTES = { nuit: -0.12, papier: 0.12 } as const;
const VUE: [number, number] = [256, 256];
const IMAGES = 4;

function scene() {
  const bati = batisseur();
  for (const [x, color] of [
    [-1.2, 0x0b1020],
    [1.2, 0xf4efe6],
  ] as const) {
    const fond = G.mesh(carre(1.2), G.basicSurface({ color, side: G.DOUBLE_SIDE }));
    fond.position.set(x, 0, -1);
    bati.source.add(fond);
    bati.ajoute(fond, 'exact-clusters', 1.2);
  }
  MODES.forEach((mode, rang) => {
    const surface = G.basicSurface({
      color: 0xff8030,
      transparent: true,
      opacity: 0.8,
      side: G.DOUBLE_SIDE,
    });
    Object.assign(surface, { blending: hostBlending(mode) });
    const tuile = G.mesh(carre(DEMI), surface);
    tuile.position.y = RANGEES[rang];
    bati.source.add(tuile);
    bati.ajoute(tuile, 'clustered-blend', DEMI);
  });
  return bati.fini();
}

/** `device` as a device that cannot write the visibility target: the fallback's one trigger. */
function sansVisibilite(device: GPUDevice) {
  const { device: handle } = sessionHandle(device, sessionTag(584));
  const make = handle.createRenderPipeline.bind(handle);
  handle.createRenderPipeline = (descriptor) => {
    if ([...(descriptor.fragment?.targets ?? [])].some((t) => t?.format === 'r32uint'))
      throw new Error('VISIBILITY_TARGET_REFUSED');
    return make(descriptor);
  };
  return handle;
}

/** The RGBA read where world point `(x, y, 0)` projects, bottom-left origin like `capture`. */
function lu(pixels: Uint8Array, camera: G.GraphCamera, x: number, y: number) {
  const p = project(new G.Vector3(x, y, 0), camera),
    px = Math.round(((p.x + 1) / 2) * (VUE[0] - 1)),
    py = Math.round(((p.y + 1) / 2) * (VUE[1] - 1)),
    i = (py * VUE[0] + px) * 4;
  return Array.from(pixels.subarray(i, i + 4));
}

/** One side: its last image, each tile and the background over each half, what it fell back to. */
async function cote(device: GPUDevice, evenements: unknown[], nom: string) {
  const s = scene(),
    camera = cameraFace();
  // No GPU canvas on either side: one refuses the fallback at prepare, by name.
  const { backend, canvas } = engine(
    webgpuPagesBackend,
    s,
    device,
    (e) => evenements.push({ cote: nom, ...e }),
    { gpuCanvas: undefined, viewport: [...VUE] },
  );
  try {
    await backend.prepare();
    let pixels: Uint8Array = new Uint8Array(0);
    for (let i = 0; i < IMAGES; i++) pixels = (await image(backend, camera)).pixels;
    const tuiles = MODES.map((mode, rang) => ({
      mode,
      ...Object.fromEntries(
        Object.entries(COTES).map(([moitie, x]) => [moitie, lu(pixels, camera, x, RANGEES[rang])]),
      ),
    }));
    const fond = Object.fromEntries(
      Object.entries(COTES).map(([moitie, x]) => [moitie, lu(pixels, camera, x, 0)]),
    );
    const repli = backend.capabilities.unsupported.includes('visibility buffer');
    return { pixels, lecture: { repli, fond, tuiles } };
  } finally {
    libere(backend, canvas, s);
  }
}

export async function executer() {
  return executerAppareil<{ principal: unknown; repli: unknown; pixelsDifferents: number }>(
    async (device, evenements, resultat) => {
      const principal = await cote(device, evenements, 'principal');
      resultat.principal = principal.lecture;
      const repli = await cote(sansVisibilite(device), evenements, 'repli');
      resultat.repli = repli.lecture;
      resultat.pixelsDifferents = difference(principal.pixels, repli.pixels);
    },
  );
}
