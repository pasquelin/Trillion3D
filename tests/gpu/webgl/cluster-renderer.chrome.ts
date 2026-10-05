// The engine's WebGL2 cluster program draws a batch record itself, in Chrome: into the host's
// canvas, and into an sRGB framebuffer under a scissor without touching what lies outside it; its
// sun and Fresnel light the surface to the byte the witness gives; a spot without penumbra, a far
// translation, a neutral normal map, the four maps it reads and the tangent frame it rebuilds all
// shade as the same surface; it refuses what it cannot draw before any pass; a held frame across a
// lost context is drawn again; and on curved and mirrored surfaces it is no farther from a
// supersampled image of the same shading than the witness is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { inChrome } from '../kit/onChrome.ts';
import type { execute } from './clusterRendererPage.ts';

const PAGE = resolve(import.meta.dirname, 'clusterRendererPage.ts');

/** Whether two pixels lie within one 8-bit level on every channel. */
const withinOneLevel = (a: number[], b: number[]) =>
  a.every((value, i) => Math.abs(value - b[i]) <= 1);
const span = (values: number[]) => Math.max(...values) - Math.min(...values);

test(
  'the WebGL2 cluster program draws, lights and refuses as the host image needs',
  { timeout: 300_000 },
  async () => {
    const result = await inChrome<Awaited<ReturnType<typeof execute>>>(PAGE, 'execute');
    console.log(JSON.stringify(result));
    // 0.18 linear red, sRGB-encoded on the canvas; a mirror draws the same front face.
    assert.deepEqual(result.canvasCenter, [118, 0, 0, 255]);
    assert.deepEqual(result.mirroredFront, result.canvasCenter);
    // An sRGB framebuffer encodes itself: inside the scissor the same bytes, outside the clear.
    assert.equal(result.framebufferStatus, 36053);
    assert.equal(result.drawError, 0);
    assert.deepEqual(result.fboInside, [118, 0, 0, 255]);
    assert.deepEqual(result.fboOutside, [0, 0, 255, 255]);
    assert.equal(
      result.opaqueAlpha,
      255,
      'an opaque surface writes full alpha whatever its opacity',
    );
    assert.equal(result.maskAlpha, 255, 'a MASK surface stays opaque past its cutoff');
    assert.deepEqual(result.ambient, [118, 0, 0, 255]);
    // The sun lights the surface as the witness does, to the byte (its Fresnel fit and light units).
    assert.deepEqual(result.direct, [70, 11, 11, 255]);
    assert.deepEqual(result.direct, result.directWitness);
    assert.ok(result.zeroPenumbraSpot[0] > 0, 'a spot without penumbra still lights its axis');
    assert.deepEqual(result.translatedDirect, result.direct, '1e8 away, the same pixel');
    assert.deepEqual(result.neutralNormal, result.direct, 'a neutral normal map changes nothing');
    assert.equal(result.invisibleSubmissions, 0);
    assert.equal(result.rejected, true, 'premultiplied BLEND is refused before any pass');
    assert.equal(result.decayRejected, true, 'a point light without physical decay is refused');
    assert.deepEqual(result.textures, {
      linearMap: [118, 118, 118, 255],
      basicAo: [118, 118, 118, 255],
      linearEmissive: [118, 118, 118, 255],
      uv1Transform: [255, 255, 0, 255],
    });
    // The tangent is rebuilt from the triangle (no attribute): a tilted normal map shades as the
    // same tilt baked into the vertex normals, within one 8-bit level, and a mirrored v flips the
    // tilt's y (the frame's handedness), so the two mapped pixels differ.
    const { normalFrames } = result;
    assert.ok(withinOneLevel(normalFrames.tilted, normalFrames.tiltedWitness));
    assert.ok(withinOneLevel(normalFrames.mirrored, normalFrames.mirroredWitness));
    assert.notDeepEqual(normalFrames.tilted, normalFrames.mirrored);
    // Drawn red, held, the texture turned lime, the context lost and restored: drawn again, lime.
    assert.deepEqual(result.heldRestore, { draws: 2, restoredPixel: [0, 255, 0, 255] });
    assert.ok(
      result.curved.every((entry) => entry.rawNonBlack > 500),
      'the sphere is drawn',
    );
    const rawMotion = result.curvedMotion.map((frame) => frame.rawCenter[0]);
    const referenceMotion = result.curvedMotion.map((frame) => frame.referenceCenter[0]);
    assert.ok(span(rawMotion) <= span(referenceMotion), 'no more shimmer than the witness');
    const { spatial, temporal } = result.curvedOracle;
    for (const [name, gap] of Object.entries({ spatial, temporal })) {
      assert.ok(gap.owned.rms <= gap.witness.rms, `${name}: RMS ${JSON.stringify(gap)}`);
      assert.ok(gap.owned.max <= gap.witness.max, `${name}: max ${JSON.stringify(gap)}`);
    }
    assert.deepEqual(result.winding.modelMirror.owned, result.winding.modelMirror.witness);
    assert.deepEqual(result.winding.cameraMirror.owned, result.winding.cameraMirror.witness);
  },
);
