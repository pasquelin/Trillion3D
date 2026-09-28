import {
  animation,
  geometry,
  light,
  material,
  math,
  object,
} from '../../../packages/sdk-browser/src/index.ts';
import { describe, type ControlSpec } from '../../../site/examples/kit/controls.ts';
import { runExampleModule } from './capture.ts';

/**
 * Runs an example page that builds its scene from the engine's own branches, `world` standing
 * for the one `createWorld` returns and the kit's `controls` caught: resolves to the panel's
 * values, which a test edits, and the page's callback, which it calls with them.
 */
export async function runControlledExample<Values>(html: string, world: object) {
  let values!: Values, change!: (next: Values) => void;
  await runExampleModule(html, {
    engine: { animation, createWorld: () => world, geometry, light, material, math, object },
    kit: {
      controls: (specs: Record<string, ControlSpec>, callback: (next: Values) => void) => {
        values = describe(specs).values as Values;
        change = callback;
        callback(values);
        return values;
      },
    },
  });
  return { values, change };
}
