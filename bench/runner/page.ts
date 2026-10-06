// What runs INSIDE the page. Playwright serialises this function: it cannot read any variable or
// call any module function; everything reaches it through its single argument. That is the reason,
// and the only one, why world creation is duplicated between `readBounds` below and
// `measureView` in `lightingPage.ts`, which the page imports by URL.
import type * as SdkBrowser from '../witnesses/measurement.ts';
import type { Bounds } from './trajectory/poses.ts';

/** What `readBounds` needs to open a tiny world: the SDK and manifest it points the page at. */
export interface BoundsOptions {
  sdkUrl: string;
  manifestUrl: string;
  /** Keep the world, its physics on, for the street probe that follows in this page
   *  (`probeColumns`, `street/streetPage.ts`): the model is loaded once for both (#1016). */
  street?: boolean;
}

/** Model bounds — the box the loaded model spans (`LoadedModel.bounds`) —, read on a tiny world:
 *  they give the bench poses. */
export async function readBounds(options: BoundsOptions): Promise<Bounds> {
  const sdk = (await import(options.sdkUrl)) as typeof SdkBrowser;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:64px;height:64px';
  document.body.append(canvas);
  const world = sdk.createWorld(canvas, { physics: options.street === true });
  const close = () => {
    world.dispose();
    canvas.remove();
  };
  try {
    await world.ready;
    const model = await world.scene.load(options.manifestUrl),
      { min, max } = model.bounds;
    // Left on the page's global for `probeColumns`, which closes it, with the folder the engine
    // reads the model's cooked files from (`cookedPhysics`).
    if (options.street)
      Object.assign(globalThis, {
        __trillion3dStreetWorld: { world, close, base: model.record.base },
      });
    else close();
    return { min: { x: min.x, y: min.y, z: min.z }, max: { x: max.x, y: max.y, z: max.z } };
  } catch (error) {
    close();
    throw error;
  }
}
