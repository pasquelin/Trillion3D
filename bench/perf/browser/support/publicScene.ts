import * as THREE from 'three';
import { readCacheManifest } from '../../../runner/cacheManifest.ts';
import type { DagPage } from './dagCut.ts';
import { prepareAutonomousManifest } from '../../../../packages/sdk-browser/src/backend/autonomous/manifest.ts';
import { pose } from '../../../../packages/sdk-browser/src/world/pose/index.ts';
import { framingFromBounds } from '../../../../packages/sdk-browser/src/camera/framing.ts';
import { Box3 } from '../../../../packages/sdk-core/src/world/math/box3.ts';
import { Vector3, readVec3 } from '../../../../packages/sdk-core/src/world/math/vector3.ts';

/**
 * A public scene's cache (`full`, the directory of its pointer `manifest.json`) as the WebGL2 pool tests draw
 * it: one selection root per primitive, placed where its pages lie, each page at its decoded size.
 * The camera frames the pages (`pose.fromBounds`, `framingFromBounds`'s near and far planes) and
 * closes 40 % of the way to their centre.
 */
export function publicScene(full: string) {
  const { metadata, descriptors } = prepareAutonomousManifest(readCacheManifest(full).manifest);
  const box = new Box3();
  const primitives = metadata.primitives.map((primitive) =>
    primitive.pages.map((page): DagPage => {
      box.expandByPoint({ x: page.min[0], y: page.min[1], z: page.min[2] });
      box.expandByPoint({ x: page.max[0], y: page.max[1], z: page.max[2] });
      return {
        url: page.url,
        level: page.level,
        triangles: page.count / 3,
        min: page.min,
        max: page.max,
        sphere: page.sphere,
        lodError: page.lodError,
        parentError: page.parentError,
        parentSphere: page.parentSphere,
        group: page.group,
        source: page.source,
      };
    }),
  );
  const view = pose.fromBounds(box, { aspect: 16 / 9 });
  const { near, far } = framingFromBounds(
    box.getBoundingSphere({ center: new Vector3(), radius: 0 }).radius,
    16 / 9,
  );
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, near, far);
  const target = new THREE.Vector3(...readVec3(view.target));
  camera.position.set(...readVec3(view.position)).lerp(target, 0.4);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return {
    primitives,
    camera,
    bytes: (url: string) => descriptors.get(url)!.uncompressedBytes,
  };
}
