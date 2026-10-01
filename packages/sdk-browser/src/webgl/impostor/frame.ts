import type { ImpostorMaps } from '../../../../sdk-core/src/index.ts';
import type { BackendContext } from '../../backend/types.ts';
import type { EngineCamera } from '../../camera/world.ts';
import type { ClusterRoot } from '../../page/selection/types.ts';
import { sendEngineDiagnostic } from '../../diagnostic/engineDiagnostic.ts';
import { createImpostorCards, dropImpostorCards, planImpostorCards } from '../../impostor/cards.ts';
import { createWebglCardDraw } from './draw.ts';
import type { WebglCards } from './pass.ts';
import { createWebglImpostorFeed, type WebglAtlas } from './feed.ts';

/**
 * THE IMPOSTOR TIER ON WEBGL2 (#1336): the same switch and the same card as WebGPU. Each image
 * plans the shared plan (`planImpostorCards`) before its cut, so the CPU cut leaves a switched
 * root to its card (`CARD_ROOT`) in the same breath, and each card waits for its mesh's atlas, read
 * through the engine's one held-level read and its level store (`createWebglImpostorFeed`), within
 * the one texture budget's room (`room`): a root whose atlas streams keeps its clusters. `cards`
 * then draws them (`createWebglCardDraw`). A session without a baked section, a level reader or a
 * context makes nothing. A restored context drops every atlas and program: the next images read
 * and make them again, the roots keeping their clusters meanwhile.
 */
export function createWebglImpostors(
  context: Pick<BackendContext, 'metadata' | 'readTextureLevel' | 'webglContext' | 'onDiagnostic'>,
  roots: readonly ClusterRoot<unknown>[],
  gate: { resourcesChanged: () => void },
  room: () => number,
) {
  const section = context.metadata.impostors,
    reader = context.readTextureLevel,
    gl = context.webglContext;
  if (!section?.baked || !reader || !gl) return undefined;
  const state = createImpostorCards<WebglAtlas>(section);
  const onFailure = (phase: string, error: unknown) =>
    sendEngineDiagnostic(context.onDiagnostic, phase, String(error), { kind: 'error' });
  // A landed level or a made atlas breaks a held image.
  const feedOptions = { room, landed: gate.resourcesChanged, onFailure },
    makeFeed = () => createWebglImpostorFeed(gl, reader, feedOptions);
  let feed = makeFeed(),
    draw = createWebglCardDraw(gl),
    image = 0;
  const atlasOf = (mesh: number, maps: ImpostorMaps) => feed.group(mesh, maps, image);
  const restored = () => {
    feed.dispose();
    draw.dispose();
    [feed, draw] = [makeFeed(), createWebglCardDraw(gl)];
    dropImpostorCards(state, roots);
  };
  gl.canvas.addEventListener('webglcontextrestored', restored);
  const cards: WebglCards = (camera, lights, pass, linear) =>
    draw.draw(state, image, camera, lights, pass, linear);
  return {
    state,
    cards,
    /** The image's plan at `cam` for `viewport`, before its cut. */
    plan(cam: EngineCamera, viewport: readonly number[] | undefined) {
      image++;
      planImpostorCards(state, roots, cam, viewport, atlasOf);
    },
    dispose() {
      gl.canvas.removeEventListener('webglcontextrestored', restored);
      dropImpostorCards(state, roots);
      feed.dispose();
      draw.dispose();
    },
  };
}

export type WebglImpostors = NonNullable<ReturnType<typeof createWebglImpostors>>;
