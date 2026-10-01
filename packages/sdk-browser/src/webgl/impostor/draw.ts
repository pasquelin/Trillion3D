import { CLUSTER_FRAGMENT, CLUSTER_LINEAR_FRAGMENT } from '../cluster/shaders.ts';
import { createWebglProgram } from '../core/program.ts';
import { setClusterSamplers, uniformLocations } from '../cluster/uniforms.ts';
import { WebglClusterLights, type WebglClusterScene } from '../cluster/lights.ts';
import { FLOAT_TEXELS, WebglLightTexture } from '../cluster/lightTexture.ts';
import { CARD_FLOATS, type ImpostorCards } from '../../impostor/cards.ts';
import type { HostDrawCamera } from '../../camera/world.ts';
import { CARD_TEXELS, CARD_VERTEX, cardFragment } from './cardGlsl.ts';
import { ATLAS_UNITS, CARD_RECORD_UNIT, type WebglAtlas } from './feed.ts';

/** What the card program reads of the pass it draws in: the cluster program's output and
 *  reflection switches there (`../cluster/renderer.ts`). */
export type CardPass = {
  toneMapped: boolean;
  srgbDestination: boolean;
  /** The mirror capture pass; the screen reflections read; their reduced image resolved. */
  capture: boolean;
  reflections: boolean;
  resolve: boolean;
  /** The display curve's rank (`TONE_MAPPING_RANK`). */
  toneCurve: number;
};
/** The switches a pass of the cluster program sets: the output's curve and encoding, the mirror
 *  capture, the screen reflections. */
export type CardSwitches = [
  toneMapped: boolean,
  srgbDestination: boolean,
  capture: boolean,
  reflections: boolean,
];
export const cardPass = (
  toneCurve: number,
  resolve: boolean,
  ...[toneMapped, srgbDestination, capture, reflections]: CardSwitches
): CardPass => ({ toneMapped, srgbDestination, capture, reflections, resolve, toneCurve });

/** The image's card draw as the WebGL2 renderer calls it, in each pass its clusters draw in; false
 *  when it drew nothing. */
export type WebglCards = (
  camera: HostDrawCamera,
  scene: WebglClusterScene,
  pass: CardPass,
  linear: boolean,
) => boolean;

/** One card program — the display's or the effect chain's linear variant — and its lights. */
function createCardProgram(gl: WebGL2RenderingContext, linear: boolean) {
  const fragment = cardFragment(linear ? CLUSTER_LINEAR_FRAGMENT : CLUSTER_FRAGMENT),
    program = createWebglProgram(gl, CARD_VERTEX, fragment),
    at = uniformLocations(gl, program);
  gl.useProgram(program);
  setClusterSamplers(gl, at);
  gl.uniform1i(at('impostorCards'), CARD_RECORD_UNIT);
  ['impostorColour', 'impostorNormalDepth', 'impostorOrm'].forEach((name, map) =>
    gl.uniform1i(at(name), ATLAS_UNITS[map]),
  );
  // A card is a lit, covering surface of the standard model; every other switch stays off.
  gl.uniform1i(at('lit'), 1);
  gl.uniform1i(at('covering'), 1);
  return { program, at, lights: new WebglClusterLights(gl, program) };
}

const eye = new Float32Array(3),
  view = new Float32Array(16);

/**
 * THE CARD DRAW ON WEBGL2 (#1336): the image's cards (`impostor/cards.ts`) drawn by the card
 * program (`cardGlsl.ts`) into the pass the cluster program draws, one instanced draw per mesh
 * atlas, as on WebGPU. The records go up once an image, into a float texture as the light records
 * do (`WebglLightTexture`); the program's lights are the scene's, uploaded as the cluster program's
 * are. A card is opaque: depth-tested and written, never blended or culled. The caller binds its
 * own program again and forgets its cached state after (`../cluster/renderer.ts`).
 */
export function createWebglCardDraw(gl: WebGL2RenderingContext) {
  const programs: Partial<Record<'display' | 'linear', ReturnType<typeof createCardProgram>>> = {};
  const records = new WebglLightTexture(
    gl,
    CARD_RECORD_UNIT,
    FLOAT_TEXELS,
    Float32Array,
    'texture',
  );
  const vao = gl.createVertexArray();
  let sent: unknown;
  return {
    /** Draws `cards`' image `image` with `camera`, in a pass `pass` describes; false without
     *  cards, nothing then drawn or bound. */
    draw(
      cards: ImpostorCards<WebglAtlas>,
      image: number,
      camera: HostDrawCamera,
      scene: WebglClusterScene,
      pass: CardPass,
      linear: boolean,
    ) {
      const { count, runs, runCount } = cards;
      if (!count) return false;
      const card = (programs[linear ? 'linear' : 'display'] ??= createCardProgram(gl, linear));
      gl.useProgram(card.program);
      if (sent !== image) {
        records.reserve(count * CARD_TEXELS);
        records.data.set(cards.records.subarray(0, count * CARD_FLOATS));
        records.upload(count * CARD_TEXELS);
        sent = image;
      } else records.bind();
      const at = card.at;
      view.set(camera.view);
      eye.set(camera.eye);
      gl.uniformMatrix4fv(at('projectionMatrix'), false, camera.projection);
      gl.uniformMatrix4fv(at('cardView'), false, view);
      gl.uniform3fv(at('cardEye'), eye);
      gl.uniform1i(at('toneCurve'), pass.toneCurve);
      gl.uniform1i(at('toneMapped'), pass.toneMapped ? 1 : 0);
      gl.uniform1i(at('srgbDestination'), pass.srgbDestination ? 1 : 0);
      gl.uniform1i(at('reflectionCapture'), pass.capture ? 1 : 0);
      gl.uniform1i(at('reflectionEnabled'), pass.reflections ? 1 : 0);
      gl.uniform1i(at('reflectionResolve'), pass.resolve ? 1 : 0);
      card.lights.upload(scene, camera.view);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.colorMask(true, true, true, true);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindVertexArray(vao);
      for (let r = 0; r < runCount; r++) {
        const { group, first, count: cardsInRun } = runs[r];
        group.forEach((texture, map) => {
          gl.activeTexture(gl.TEXTURE0 + ATLAS_UNITS[map]);
          gl.bindTexture(gl.TEXTURE_2D, texture);
        });
        gl.uniform1i(at('firstCard'), first);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, cardsInRun);
      }
      return true;
    },
    dispose() {
      for (const card of Object.values(programs)) {
        card.lights.dispose();
        gl.deleteProgram(card.program);
      }
      records.dispose();
      gl.deleteVertexArray(vao);
    },
  };
}
