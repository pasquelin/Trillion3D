import assert from 'node:assert/strict';
import {
  animation,
  camera,
  geometry,
  light,
  material,
  math,
  object,
} from '../../../packages/sdk/browser.ts';
import { describe, type ControlSpec } from '../../../site/examples/kit/controls.ts';
import { runExampleModule } from './capture.ts';

/** Runs the real page with one shared control panel and optional test-specific engine or kit IO. */
export async function runControlledExample<Values>(
  html: string,
  world: object,
  overrides: { engine?: object; kit?: object } = {},
) {
  let values!: Values, change!: (next: Values, key?: keyof Values) => void;
  let specs!: Record<string, ControlSpec>;
  await runExampleModule(html, {
    engine: {
      animation,
      camera,
      createWorld: () => world,
      geometry,
      light,
      material,
      math,
      object,
      ...overrides.engine,
    },
    kit: {
      ...overrides.kit,
      controls: (
        nextSpecs: Record<string, ControlSpec>,
        callback: typeof change,
        watched?: object,
      ) => {
        assert.equal(watched, world);
        specs = nextSpecs;
        values = describe(specs).values as Values;
        change = callback;
        callback(values);
        return values;
      },
    },
  });
  return { values, change, specs };
}
