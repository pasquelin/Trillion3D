// First part of the foundation bench, `sdk-browser` consumers: each computation attached to
// the foundation, opposed to the code it was before, copied in `oracles/socle-math*.mjs`.
// A single different value and the line fails: the attachment changes no bit.
import * as THREE from 'three';
import { srgbToLinear } from '../../../sdk-core/index.ts';
import { orderPendingUrls } from '../../streamingPriority.ts';
import { linearToSrgb8 } from '../../visibilityMath.ts';
import { projectVisibilityVertex } from '../../visibilityProjection.ts';
import { setWindingEpoch, windingCw } from '../../webgpuPagesWinding.ts';
import { noteResidenceChange } from '../../webgpuShadowBounds.ts';
import * as ancien from '../oracles/socle-math.mjs';
import { referenceOrder } from '../oracles/socle-math-priorite.mjs';
import { affines, matrices, points } from './scenesSocle.mjs';
import { enregistrements, octets } from './scenesSocleConsommateurs.mjs';
import { essaie, ligne } from './socleLigne.mjs';
import { createEngineCamera, readCameraWorld } from '../../cameraWorld.ts';

export async function lignesConsommateursBrowser() {
  const { liste, camera, echelle } = enregistrements;
  // The engine order reads the camera it owns; the oracle keeps that of the host library.
  const vue = readCameraWorld(createEngineCamera(), camera);
  const paquets = [];
  for (let i = 0; i < liste.length; i += 30) paquets.push(liste.slice(i, i + 30));
  const attribut = new THREE.BufferAttribute(Float32Array.from(points.flat()), 3);
  // The compared subject is the projection of a vertex, not the read of a convention: the
  // view-projection/convention pairs are built once, outside the measured loops.
  const vuesProjetees = matrices.map((e) => ({ viewProjection: e }));
  return [
    await ligne(
      'streaming queue: rendered order',
      'packages/sdk-browser/streamingPriority.ts',
      'enregistrements hostiles, par paquets de 30',
      paquets,
      (l) => l.map((p) => essaie(() => referenceOrder(p, camera, echelle))),
      (l) => l.map((p) => essaie(() => orderPendingUrls(p, vue, echelle, []))),
    ),
    await ligne(
      'world-space cluster sphere for shadows',
      'packages/sdk-browser/webgpuShadowBounds.ts',
      'poses × boxes',
      liste,
      (l) =>
        l.map((r) => {
          const s = new Float32Array(4);
          ancien.referenceClusterSphere(r, s, 0);
          return [s[0] - s[3], s[1] - s[3], s[2] - s[3], s[0] + s[3], s[1] + s[3], s[2] + s[3]];
        }),
      (l) =>
        l.map((r) => {
          let boite;
          noteResidenceChange(
            {
              store: { count: 1 },
              plan: { worldChanged: (min, max) => (boite = [...min, ...max]) },
            },
            r,
          );
          return boite;
        }),
    ),
    await ligne(
      'sens de parcours d’un cluster',
      'packages/sdk-browser/webgpuPagesWinding.ts',
      'matrices hostiles',
      matrices,
      (l) => l.map((e) => ancien.referenceWindingCw(e)),
      (l) =>
        l.map((e, i) => {
          setWindingEpoch(i + 1);
          return windingCw({ matrix: { elements: e } });
        }),
    ),
    await ligne(
      'projected vertex of the visibility buffer',
      'packages/sdk-browser/visibilityProjection.ts',
      'poses × vues-projections × sommets',
      affines.slice(0, 60),
      (l) =>
        l.flatMap((m, i) =>
          points
            .slice(0, 40)
            .map((_, v) =>
              ancien.referenceProjectVisibilityVertex(
                new THREE.Matrix4().fromArray(m),
                attribut,
                v,
                new THREE.Matrix4().fromArray(matrices[(i * 11) % matrices.length]),
                1280,
                720,
              ),
            ),
        ),
      (l) =>
        l.flatMap((m, i) =>
          points
            .slice(0, 40)
            .map((_, v) =>
              projectVisibilityVertex(
                new THREE.Matrix4().fromArray(m),
                attribut,
                v,
                vuesProjetees[(i * 11) % vuesProjetees.length],
                1280,
                720,
              ),
            ),
        ),
    ),
    await ligne(
      'sRGB : table des octets et encodage 8 bits',
      'packages/sdk-browser/visibilityMath.ts',
      '256 octets et valeurs hostiles',
      octets,
      (l) =>
        l.map((c, i) => [ancien.referenceSrgb8Linear(i % 256), ancien.referenceLinearToSrgb8(c)]),
      (l) => l.map((c, i) => [srgbToLinear((i % 256) / 255), linearToSrgb8(c)]),
    ),
  ];
}
