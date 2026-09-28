// Controlled water coverage for #232: geometry is identical with the tile parked offscreen.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { batisseur, carre } from './sharedSceneProof.ts';
import { BACKGROUND, GROUND, WATER } from './waterPassCases.ts';

export { BACKGROUND };
export const SIZE: [number, number] = [1280, 720];
const DISTANCE = 3;
const HALF_Y = DISTANCE * Math.tan((55 * Math.PI) / 360);
const HALF_X = (HALF_Y * SIZE[0]) / SIZE[1];

export function waterCostScene(fraction: number, enabled: boolean) {
  const builder = batisseur();
  const add = (
    name: string,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    material: G.GraphSurface,
    pass: string,
  ) => {
    const mesh = G.mesh(carre(1), material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, 1);
    builder.source.add(mesh);
    builder.ajoute(mesh, pass, 1);
  };
  add(
    'ground',
    0,
    0,
    -GROUND.depth,
    10,
    10,
    G.basicSurface({ color: new G.Color(GROUND.color), side: G.DOUBLE_SIDE }),
    'exact-clusters',
  );
  // Displaced backdrop patches also exercise refraction outside the tile's projected bounds.
  for (const sign of [-1, 1])
    add(
      `patch-${sign}`,
      sign * HALF_X * Math.sqrt(fraction),
      0,
      -1,
      HALF_X / 4,
      HALF_Y / 2,
      G.basicSurface({ color: sign < 0 ? 0x993322 : 0x226699, side: G.DOUBLE_SIDE }),
      'exact-clusters',
    );
  const water = Object.assign(
    G.physicalSurface({
      color: new G.Color(WATER.tint),
      transparent: true,
      opacity: 1,
      side: G.DOUBLE_SIDE,
      roughness: 0.05,
    }),
    {
      transmission: 1,
      ior: WATER.ior,
      thickness: 2,
      attenuationDistance: WATER.attenuationDistance,
      attenuationColor: new G.Color(WATER.attenuationColor),
    },
  );
  add(
    'water',
    enabled ? 0 : 100,
    0,
    0,
    HALF_X * Math.sqrt(fraction),
    HALF_Y * Math.sqrt(fraction),
    water,
    'clustered-blend',
  );
  return builder.fini();
}

export function waterCostCamera() {
  return G.perspectiveCamera(55, SIZE[0] / SIZE[1], 0.1, 100);
}

/** The motion translates eight screen pixels, without rotating or changing projected scale. */
export function poseWaterCost(camera: G.Camera, frame: number, moving: boolean) {
  const offsetPixels = moving ? 8 * Math.sin((frame * Math.PI) / 30) : 0;
  const x = (offsetPixels / SIZE[0]) * 2 * HALF_X;
  camera.position.set(x, 0, DISTANCE);
  camera.lookAt(x, 0, 0);
  camera.updateMatrixWorld(true);
  return offsetPixels;
}

/** Analytic clipped projection, not a claim of measured raster coverage. No oversized full tile. */
export function projectedFraction(fraction: number, offsetPixels: number) {
  const halfWidth = (SIZE[0] * Math.sqrt(fraction)) / 2;
  const left = Math.max(0, SIZE[0] / 2 - halfWidth - offsetPixels);
  const right = Math.min(SIZE[0], SIZE[0] / 2 + halfWidth - offsetPixels);
  return (Math.max(0, right - left) * SIZE[1] * Math.sqrt(fraction)) / (SIZE[0] * SIZE[1]);
}
