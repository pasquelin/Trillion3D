// The constants of the ray-tracing product, written once in TypeScript
// (`packages/sdk-core/src/contracts/rayTracingAbi.ts`) and printed into the compiler's Rust
// (`../generate-shared-rules.ts`): the file's name, its magic and version, its records, its
// vertices and indexed triangles, the corner attributes, the node's width, a leaf's meta byte, the flags, the stack and
// the least exponent.
import * as tracing from '../../../packages/sdk-core/src/contracts/rayTracingAbi.ts'
import { header, rustConsts } from './statements.ts'

/** The ray-tracing product's shared constants, `ray_tracing/abi.rs`. */
export function rayTracingAbiRust() {
  return `${header(['packages/sdk-core/src/contracts/rayTracingAbi.ts'], '//!')}

/// The file, the magic, the version, the records, the vertices and indexed triangles, the corner attributes, the node's width, a leaf's meta byte, the flags, the stack and the least exponent of \`rayTracing.bin\`.
${rustConsts({
  RAY_TRACING_FILE: [tracing.RAY_TRACING_FILE, '&str'],
  RAY_TRACING_MAGIC: [tracing.RAY_TRACING_MAGIC, 'u32'],
  RAY_TRACING_VERSION: [tracing.RAY_TRACING_VERSION, 'u32'],
  RAY_TRACING_HEAD_BYTES: [tracing.RAY_TRACING_HEAD_BYTES, 'usize'],
  RAY_TRACING_RECORD_BYTES: [tracing.RAY_TRACING_RECORD_BYTES, 'usize'],
  RAY_TRACING_NODE_BYTES: [tracing.RAY_TRACING_NODE_BYTES, 'usize'],
  RAY_TRACING_TRIANGLE_BYTES: [tracing.RAY_TRACING_TRIANGLE_BYTES, 'usize'],
  RAY_TRACING_VERTEX_BYTES: [tracing.RAY_TRACING_VERTEX_BYTES, 'usize'],
  RAY_TRACING_INDEXED_TRIANGLE_BYTES: [tracing.RAY_TRACING_INDEXED_TRIANGLE_BYTES, 'usize'],
  RAY_TRACING_CORNER_BYTES: [tracing.RAY_TRACING_CORNER_BYTES, 'usize'],
  RAY_TRACING_WIDTH: [tracing.RAY_TRACING_WIDTH, 'usize'],
  RAY_TRACING_LEAF_TRIANGLES: [tracing.RAY_TRACING_LEAF_TRIANGLES, 'usize'],
  RAY_TRACING_LEAF_COUNT_SHIFT: [tracing.RAY_TRACING_LEAF_COUNT_SHIFT, 'u32'],
  RAY_TRACING_LEAF_OFFSET_MASK: [tracing.RAY_TRACING_LEAF_OFFSET_MASK, 'u8'],
  RAY_TRACING_FLAG_TWO_SIDED: [tracing.RAY_TRACING_FLAG_TWO_SIDED, 'u32'],
  RAY_TRACING_FLAG_MASKED: [tracing.RAY_TRACING_FLAG_MASKED, 'u32'],
  RAY_TRACING_FLAG_TRANSLUCENT: [tracing.RAY_TRACING_FLAG_TRANSLUCENT, 'u32'],
  RAY_TRACING_FLAG_WORLD: [tracing.RAY_TRACING_FLAG_WORLD, 'u32'],
  RAY_TRACING_FLAG_ACTOR: [tracing.RAY_TRACING_FLAG_ACTOR, 'u32'],
  RAY_TRACING_FLAG_ALL_TRANSLUCENT: [tracing.RAY_TRACING_FLAG_ALL_TRANSLUCENT, 'u32'],
  RAY_TRACING_FLAG_NORMALS: [tracing.RAY_TRACING_FLAG_NORMALS, 'u32'],
  RAY_TRACING_FLAG_ATTRIBUTES: [tracing.RAY_TRACING_FLAG_ATTRIBUTES, 'u32'],
  RAY_TRACING_NO_PRIMITIVE: [tracing.RAY_TRACING_NO_PRIMITIVE, 'u32'],
  RAY_TRACING_STACK: [tracing.RAY_TRACING_STACK, 'usize'],
  RAY_TRACING_MIN_EXPONENT: [tracing.RAY_TRACING_MIN_EXPONENT, 'i8'],
})}
`
}
