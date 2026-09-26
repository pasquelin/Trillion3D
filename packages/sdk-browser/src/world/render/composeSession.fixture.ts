// A WebGL2 session of the effect chain's tests (#349): the engine's scene draw and the composer on
// a recorded context that renders half floats, the world's refusal notices, and what they said.
import * as G from '../../host/graph/graph.fixture.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts';
import type { GraphScene } from '../../host/graph/scene.ts';
import { createSceneDraw } from '../../webgl/cluster/sceneDraw.ts';
import { createTestContext } from '../../webgl/core/testContext.fixture.ts';
import {
  createWorldNotices,
  listenWorldNotices,
  noticeEffectRefusal,
} from '../diagnostic/worldNotices.ts';
import { createFrameComposer } from './compose.ts';

const camera = G.perspectiveCamera();
/** A context that renders half floats, as every desktop WebGL2 does. */
const HALF_FLOATS = {
  getExtension: (name: string) => (name === 'EXT_color_buffer_float' ? {} : null),
};

/** A WebGL2 session drawing `scene` with the world's `chain`, its refusals said on a world's
 *  notices; `frame` draws one and returns whether the chain ran and what the scene submitted. */
export function session(scene: GraphScene, chain: EffectChain) {
  const context = createTestContext({ answers: HALF_FLOATS });
  const draw = createSceneDraw(context.gl, scene);
  const backend = { id: 'engine', scene, ...draw, ...draw.host } as unknown as RenderBackend;
  const notices = createWorldNotices();
  const refused = noticeEffectRefusal(notices);
  const compose = createFrameComposer(context.gl, camera, {
    effects: { chain, shown: () => true, refused },
  });
  return {
    frame() {
      const passes = context.of('drawArrays').length,
        submitted = context.of('drawElements').length;
      draw.render(camera);
      compose(backend, null);
      return {
        chained: context.of('drawArrays').length > passes,
        submitted: context.of('drawElements').length - submitted,
      };
    },
    close: notices.close,
  };
}

/** The kinds of every world notice said while `run` draws `view`, once delivered. */
export async function heard(view: ReturnType<typeof session>, run: () => void) {
  const said: string[] = [];
  const stop = listenWorldNotices((notice) => void said.push(notice.phase));
  run();
  await new Promise(setImmediate);
  view.close();
  stop();
  return said;
}
