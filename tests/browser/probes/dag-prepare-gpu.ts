// What a camera cut's `dagPrepare` derives once per primitive (#979, `primitiveWgsl.ts`) changes no
// verdict: the WGSL kernel actually run in Chromium WebGPU, twice on the same cases — as shipped,
// and with every reading site put back to the expression it replaced (`view · world`, the normal
// matrix and conformity of the world's 3x3, the view ahead's planes), rebuilt by
// `substitutionBefore.ts`. Requests, drawn pages, counters and totals must be the same, bit for bit.
//
// Cases: the cone sample of defect 6 (tiny, singular, mirrored and non-uniform scales, where the
// normal matrix and the conformity flag decide), and pyramids under random rotations and scales
// — zero, negative, tiny, huge on an axis — seen by a still camera and by a moving one, whose view
// ahead reads the prepared planes and `view · world` of its own.
//
// node --experimental-strip-types tests/browser/probes/dag-prepare-gpu.ts
import assert from 'node:assert/strict';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts';
import { DAG_SELECTION_SHADER } from '../../../packages/sdk-browser/src/gpu/dag/shader/shader.ts';
import {
  scenePages,
  sceneRoots,
} from '../../../packages/sdk-browser/src/gpu/dag/cutFrontierScene.fixture.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts';
import {
  readCameraMotion,
  type CameraMotion,
} from '../../../packages/sdk-browser/src/camera/motion.ts';
import { random } from '../../../packages/sdk-browser/src/page/cut/cutRuleChecks.fixture.ts';
import { vue, VIEWPORT, empaqueteCas } from './inverseTransposeCases.ts';
import { tousLesCas } from './inverseTransposeSample.ts';
import { selectionGpu } from './selectionKernelGpu.ts';
import { substitueFormeAvant } from './substitutionBefore.ts';
import { packedWorldsToRenderOrigin } from '../../../packages/sdk-browser/src/gpu/dag/pack.fixture.ts';

if (import.meta.main) {
  const ORIGINE = 'packages/sdk-browser/src/gpu/dag/shader/primitiveWgsl.ts and aheadWgsl.ts';
  /** Each prepared read, and the expression it replaced at its sites. */
  const FORMES: Array<[string, string, string]> = [
    [
      `fn viewWorld(w:u32)->mat4x4f{
 if(isLightCut()){return views[vi].view*worlds[w];}
 let at=primitiveBase(w)+select(CAMERA_E,AHEAD_E,vi==AHEAD_VIEW);
 return mat4x4f(frames[at],frames[at+1u],frames[at+2u],frames[at+3u]);
}`,
      'fn viewWorld(w:u32)->mat4x4f{\n return views[vi].view*worlds[w];\n}',
      '{\n return views[vi].view*worlds[w]',
    ],
    [
      `fn normalOf(w:u32)->InvT3{
 let at=primitiveBase(w)+NORMAL;let a=frames[at];let b=frames[at+1u];let c=frames[at+2u];
 return InvT3(mat3x3f(a.xyz,b.xyz,c.xyz),a.w,b.w!=0.0);
}`,
      'fn normalOf(w:u32)->InvT3{let m=worlds[w];return invTranspose3Prep(mat3x3f(m[0].xyz,m[1].xyz,m[2].xyz));}',
      'return invTranspose3Prep(',
    ],
    [
      'fn conformalOf(w:u32)->bool{return frames[primitiveBase(w)+NORMAL+2u].w!=0.0;}',
      'fn conformalOf(w:u32)->bool{let m=worlds[w];return isConformal(mat3x3f(m[0].xyz,m[1].xyz,m[2].xyz));}',
      'return isConformal(',
    ],
    [
      'fn outsideAhead(w:u32,bmin:vec3f,bmax:vec3f)->bool{return outsideFrustum(aheadPlanes(w),bmin,bmax);}',
      `fn outsideAhead(w:u32,bmin:vec3f,bmax:vec3f)->bool{
 if(unculledOf(w)){return false;}
 let m=transpose(worlds[w]);
 for(var i=0u;i<6u;i++){if(outsidePlane(m*views[AHEAD_VIEW].planes[i],bmin,bmax)){return true;}}
 return false;
}`,
      'm*views[AHEAD_VIEW].planes[i]',
    ],
  ];
  const AVANT = FORMES.reduce(
    (texte, [livre, before, marqueur]) =>
      substitueFormeAvant({
        texte,
        livre,
        before,
        name: 'DAG_SELECTION_SHADER',
        origine: ORIGINE,
        marqueur,
      }),
    DAG_SELECTION_SHADER,
  );

  /** Pyramids under random poses: each axis scale drawn among the edges and a random value. */
  const next = random(979);
  const ECHELLES = [0, -1, 1e-7, 1e-3, 1, 7, 1e4];
  const echelle = () =>
    next() < 0.5 ? ECHELLES[Math.floor(next() * ECHELLES.length)] : 0.2 + 3 * next();
  function monde(x: number) {
    const q = new G.Quaternion().setFromEuler(
      new G.Euler(next() * 6.3, next() * 6.3, next() * 6.3),
    );
    const s = new G.Vector3(echelle(), echelle(), echelle());
    return new G.Matrix4().compose(new G.Vector3(x, next() * 4 - 2, -next() * 6), q, s);
  }
  const pages = scenePages(512, 6);

  /** The camera at `x`, still, or moving along +x over the last tenth of a second. */
  function cameraAt(x: number, speed: number) {
    const camera = G.perspectiveCamera(55, 16 / 9, 0.1, 200);
    const at = (px: number) => {
      camera.position.set(px, 0, 12);
      camera.lookAt(px, 0, 0);
      camera.updateMatrixWorld(true);
      return cameraMoteur(camera);
    };
    if (!speed) return { cam: at(x), motion: undefined };
    const motion: CameraMotion = {};
    readCameraMotion(at(x - speed * 0.1), motion, 0);
    const cam = at(x);
    readCameraMotion(cam, motion, 100);
    return { cam, motion };
  }

  const scenes = Array.from({ length: 6 }, (_, n) => {
    const roots = sceneRoots(
      pages,
      Array.from({ length: 8 }, (_, w) => monde(w * 5 - 17.5)),
      true,
    );
    const { cam, motion } = cameraAt(n * 3 - 7.5, n % 2 ? 40 : 0);
    const uniforms = cameraSelectionUniforms(cam, 1 + n, [1280, 720], undefined, motion);
    assert.equal(uniforms.ahead != null, n % 2 === 1, 'a moving camera sends its view ahead');
    return {
      name: `pyramids ${n}${motion ? ' moving' : ''}`,
      packed: packedWorldsToRenderOrigin(packDagSelection(roots), roots, uniforms.cameraWorld),
      uniforms,
    };
  });
  const cas = [
    {
      name: 'cones',
      packed: empaqueteCas(tousLesCas),
      uniforms: cameraSelectionUniforms(vue, 0, VIEWPORT),
    },
    ...scenes,
  ];

  const livre = await selectionGpu(cas);
  const avant = await selectionGpu(cas, AVANT);
  for (const gpu of [livre, avant]) {
    assert.equal(gpu.indisponible ?? null, null);
    assert.deepEqual([...(gpu.compilation ?? []), ...(gpu.erreurs ?? [])], []);
  }
  const lignes = cas.map(({ name }) => {
    const a = livre.resultats?.find((r) => r.name === name),
      b = avant.resultats?.find((r) => r.name === name);
    assert.ok(a && b, `${name}: missing GPU result`);
    // Requests of equal priority come in the order threads appended them: compared as a set of words,
    // each word its page and its priority.
    const sans = (r: typeof a) => ({ ...r, demandes: r.demandes.toSorted((x, y) => x - y) });
    assert.deepEqual(sans(a), sans(b), `${name}: the prepared values change the cut`);
    return {
      name,
      demandes: a.demandes.length,
      dessinees: a.dessinees.length,
      vivantes: a.vivantes,
    };
  });
  assert.ok(
    lignes.every((l) => l.dessinees > 0),
    'every case draws something',
  );
  console.log(JSON.stringify({ adaptateur: livre.adaptateur, lignes }, null, 2));
}
