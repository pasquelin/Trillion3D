/**
 * One baked impostor over the DAG fixture's root, as the runtime tests of both GPU paths read it
 * (`webgpu/impostor/frame.test.ts`, `webgl/impostor/frame.test.ts`): its section, its roots, a level
 * reader answering decoded levels, and the cameras and cut they are seen with.
 */
import type { ImpostorSection } from '../../../sdk-core/src/index.ts';
import { collectClusterPages, selectVisiblePages } from '../page/selection/selection.ts';
import { dagFixture, frontCamera } from '../page/selection/dag.fixture.ts';
import { createEngineCamera, readCameraWorld } from '../camera/world.ts';
import type { TextureLevelReader, TextureLevelRequest } from '../texture/levelReader.ts';

export const VIEWPORT: [number, number] = [1280, 720];
/** Deliberately not the root's rank: the card names the mesh, the cut reads the rank. */
export const MESH = 3;
const level = (name: string) => ({
  url: `../../objects/${name}.png`,
  sha256: name.repeat(64),
  bytes: 64,
  width: 8,
  height: 8,
});
export const impostorSection: ImpostorSection = {
  version: 1,
  frames: 12,
  focalPixels: 1117,
  textureLimit: 8192,
  baked: 1,
  refused: 0,
  meshes: [
    {
      ...{ mesh: MESH, sourceMesh: MESH, name: 'fixture', placements: 1, masked: false },
      ...{ rootTriangles: 100, radius: 1, status: 'baked', coverage: 0.5, hemi: false },
      ...{ frames: 12, frameSide: 64, atlasSide: 768, objectRadius: 1 },
      switchDepth: { texel: 0, triangles: 0 },
      maps: {
        colourCoverage: { kind: 'coverage', levels: [level('a')] },
        normalDepth: { kind: 'data', levels: [level('b')] },
        orm: { kind: 'data', levels: [level('c')] },
      },
    },
  ],
};
/** The three levels' urls, in the order the atlas asks them. */
export const ATLAS_URLS = ['a', 'b', 'c'].map((name) => `../../objects/${name}.png`);

/** The DAG fixture's roots, each standing for `MESH`, and a reader answering decoded levels. */
export function impostorScene() {
  const asked: TextureLevelRequest[] = [];
  const reader = (async (request: TextureLevelRequest) => {
    asked.push(request);
    return { width: 8, height: 8, close() {} } as ImageBitmap;
  }) as TextureLevelReader;
  const fixture = dagFixture();
  const { roots } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  for (const root of roots) root.mesh = MESH;
  return { fixture, roots, reader, asked };
}

/** The engine camera on the axis at `z`, looking at the root. */
export const engineAt = (z: number) => readCameraWorld(createEngineCamera(), frontCamera(z, 5000));
/** The CPU camera cut of `roots` from `z`. */
export const cutAt = (roots: ReturnType<typeof impostorScene>['roots'], z: number) =>
  selectVisiblePages(roots, engineAt(z), { pixelError: 0, viewport: VIEWPORT });
/** Lets the levels asked land: each image lands what the one before asked. */
export const settle = () => new Promise((resolve) => setImmediate(resolve));
