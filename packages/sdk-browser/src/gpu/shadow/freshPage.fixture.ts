import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { SHADOW_FACE_STRIDE } from './batchBudget.ts';
import { SHADOW_FACE_READ_WORDS } from './faceReadWords.ts';
import { createShadowRecordPack } from './recordPack.ts';
import { SHADOW_DEPTH_SHADER } from './shader.ts';

type FreshShader = {
  freshPlace: (view: object, p: number[]) => number[];
  freshInPage: (view: object, at: number[]) => boolean;
};
let shader: FreshShader | undefined;

/**
 * Physical page `physical` of a pool `side` pages wide, drawn by the GPU through `matrix`, as the
 * shipped depth shader reads it (`freshPlace`, `freshInPage`): the face words the host writes
 * (`writePage`), where a clip point lands in the layer's window, in texels, and whether the page
 * keeps a fragment at a window position.
 */
export function freshPage(side: number, physical: number, matrix = new Float32Array(16)) {
  shader ??= shaderRun<FreshShader>(
    SHADOW_DEPTH_SHADER,
    ['freshPlace', 'freshInPage', 'pageHolds', 'pageFirst'],
    {},
  );
  const { freshPlace, freshInPage } = shader;
  const pack = createShadowRecordPack(SHADOW_FACE_STRIDE, side);
  pack.writePage(0, matrix, 0, physical, undefined, 0);
  const words = pack.facePacked,
    size = side * SHADOW_PAGE;
  const view = {
    view: { params: [...words.subarray(16, 20)] },
    rect: [...words.subarray(SHADOW_FACE_READ_WORDS, SHADOW_FACE_READ_WORDS + 4)],
  };
  return {
    window(clip: number[]) {
      const [px, py, , w] = freshPlace(view, clip);
      return [((px / w + 1) / 2) * size, ((1 - py / w) / 2) * size];
    },
    holds: (at: number[]) => freshInPage(view, at),
  };
}
