// The blend item record laid out again from the struct the shaders compile (`BLEND_ITEM_WGSL`), by
// the one table rule the writer's words come from (`fieldLayout`): where a test reads a field of a
// record the engine sent up, as the shaders read it.
import { BLEND_ITEM_WGSL } from './items.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'

type FieldType = Parameters<typeof fieldLayout>[1][number][1]

/** The shipped struct's fields, in order, laid out as WGSL lays them. */
export const BLEND_ITEM_SHIPPED = fieldLayout(
  'BlendItem',
  Array.from(
    wgslSource(BLEND_ITEM_WGSL).matchAll(/(\w+):(\w+),/g),
    ([, name, type]) => [name, type as FieldType] as const,
  ),
)
