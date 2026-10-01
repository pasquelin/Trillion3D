import { CLUSTER_FRAGMENT, CLUSTER_LINEAR_FRAGMENT } from '../cluster/shaders.ts';
import { createWebglProgram } from '../core/program.ts';
import { setClusterSamplers, uniformLocations } from '../cluster/uniforms.ts';
import type { WebglClusterLights } from '../cluster/lights.ts';
import { FLOAT_TEXELS, WebglLightTexture } from '../cluster/lightTexture.ts';
import { CARD_FLOATS, type ImpostorCards } from '../../impostor/cards.ts';
import type { HostDrawCamera } from '../../camera/world.ts';
import { ATLAS_SAMPLERS, CARD_TEXELS, CARD_VERTEX, cardFragment } from './cardGlsl.ts';
import { ATLAS_UNITS, CARD_RECORD_UNIT, type WebglAtlas } from './feed.ts';
import type { CardPass } from './pass.ts';

/** One card program — the display's or the effect chain's linear variant. */
function createCardProgram(gl: WebGL2RenderingContext, linear: boolean) {
  const fragment = cardFragment(linear ? CLUSTER_LINEAR_FRAGMENT : CLUSTER_FRAGMENT),
    program = createWebglProgram(gl, CARD_VERTEX, fragment),
    at = uniformLocations(gl, program);
  gl.useProgram(program);
  setClusterSamplers(gl, at);
  gl.uniform1i(at('impostorCards'), CARD_RECORD_UNIT);
  ATLAS_SAMPLERS.forEach((name, map) => gl.uniform1i(at(name), ATLAS_UNITS[map]));
  // A card is a lit, covering surface of the standard model; every other switch stays off.
  gl.uniform1i(at('lit'), 1);
  gl.uniform1i(at('covering'), 1);
  return { program, at };
}

const view = new Float32Array(16);

/**
 * THE CARD DRAW ON WEBGL2 (#1336): the image's cards (`impostor/cards.ts`) drawn by the card
 * program (`cardGlsl.ts`) into the pass the cluster program draws, one instanced draw per mesh
 * atlas, as on WebGPU. The records go up once an image, into a float texture as the light records
 * do (`WebglLightTexture`); the program's lights are those the cluster program uploaded for the
 * pass, their uniforms sent again (`WebglClusterLights.send`). A card is opaque: depth-tested and written, never blended or culled. The caller binds its
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
      lights: WebglClusterLights,
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
      gl.uniformMatrix4fv(at('projectionMatrix'), false, camera.projection);
      gl.uniformMatrix4fv(at('cardView'), false, view);
      gl.uniform3fv(at('cardEye'), camera.eye);
      gl.uniform1i(at('toneCurve'), pass.toneCurve);
      gl.uniform1i(at('toneMapped'), pass.toneMapped ? 1 : 0);
      gl.uniform1i(at('srgbDestination'), pass.srgbDestination ? 1 : 0);
      gl.uniform1i(at('reflectionCapture'), pass.capture ? 1 : 0);
      gl.uniform1i(at('reflectionEnabled'), pass.reflections ? 1 : 0);
      gl.uniform1i(at('reflectionResolve'), pass.resolve ? 1 : 0);
      lights.send(at);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.colorMask(true, true, true, true);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindVertexArray(vao);
      const firstCard = at('firstCard');
      for (let r = 0; r < runCount; r++) {
        const { group, first, count: cardsInRun } = runs[r];
        for (let map = 0; map < group.length; map++) {
          gl.activeTexture(gl.TEXTURE0 + ATLAS_UNITS[map]);
          gl.bindTexture(gl.TEXTURE_2D, group[map]);
        }
        gl.uniform1i(firstCard, first);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, cardsInRun);
      }
      return true;
    },
    dispose() {
      for (const card of Object.values(programs)) gl.deleteProgram(card.program);
      records.dispose();
      gl.deleteVertexArray(vao);
    },
  };
}
