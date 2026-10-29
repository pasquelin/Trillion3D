// The distance field's GPU kernel printed for the browser (`../generate-shared-rules.ts`): the
// compiler measures a mesh's voxels with the program `distance_field/gpu.rs` assembles — the
// prelude of its layout's numbers, the scene words, the walks of the shell's queries and the
// kernel —, and a mesh made at run time is measured by the same text, not a copy of it. The
// browser cannot read the crate's `.wgsl` files, so this prints the assembled program and the
// numbers the host packs and reads by, as a TypeScript module.
import { rustConstant, rustFloat, rustSource } from './rust.ts'
import { header } from './statements.ts'

const CRATE = 'packages/asset-compiler-rust/src'
const FIELD = `${CRATE}/distance_field`
const FLATTEN_GPU = `${CRATE}/hlod/flatten/gpu`
const SHELL_GPU = `${CRATE}/hlod/flatten/approximate/gpu`
const PROXY = 'packages/page-codec-wasm/src/proxy.rs'

/** The text of a WGSL file of the crate. */
const wgslOf = (path: string) => rustSource(path)

/** `value` as the digits Rust's debug form gives a single-precision float: the fewest that read
 *  back as the same float, a point always. */
function single(value: number) {
  for (let digits = 1; digits < 10; digits++) {
    const text = value.toPrecision(digits)
    if (Math.fround(Number(text)) === Math.fround(value))
      return /[.e]/.test(text) ? String(Number(text)) : `${text}.0`
  }
  throw new Error(`no short form of ${value}`)
}

/** The numbers of the layout, read from the crate, by their names. */
function layout() {
  const known = new Map<string, number>()
  const read = (path: string, names: readonly string[]) =>
    names.forEach((name) => known.set(name, rustConstant(path, name, known)))
  read(PROXY, ['PROXY_CHILDREN'])
  read(`${FLATTEN_GPU}/layout.rs`, ['NONE', 'WORKGROUP', 'BATCH'])
  read(`${SHELL_GPU}/layout.rs`, ['MAX_DEPTH', 'BOX_NODE_RECORDS', 'TRIANGLE_RECORDS'])
  read(`${FIELD}/gpu/layout.rs`, [
    'HEAD_RECORDS',
    'MIP_RECORDS',
    'DOUBTFUL',
    'ECHO_SHIFT',
    'ECHO_MASK',
  ])
  // `stack` is a const fn the evaluator does not read: its one formula is checked, then applied.
  if (!rustSource(`${FLATTEN_GPU}/layout.rs`).includes('(PROXY_CHILDREN - 1) * depth + 1'))
    throw new Error(
      `${FLATTEN_GPU}/layout.rs: the walk's stack is no longer (children - 1) * depth + 1`,
    )
  known.set('STACK', (known.get('PROXY_CHILDREN')! - 1) * known.get('MAX_DEPTH')! + 1)
  return known
}

/** The program as the crate assembles it (`source` of `gpu.rs`): the prelude (`prelude` of
 *  `gpu/layout.rs`), the scene words, the shell's walks, the kernel. */
function program(n: ReadonlyMap<string, number>) {
  const constants = [
    ['NONE', 'NONE'],
    ['WORKGROUP', 'WORKGROUP'],
    ['STACK', 'STACK'],
    ['CHILDREN', 'PROXY_CHILDREN'],
    ['MIP_RECORDS', 'MIP_RECORDS'],
    ['BOX_NODE_RECORDS', 'BOX_NODE_RECORDS'],
    ['TRIANGLE_RECORDS', 'TRIANGLE_RECORDS'],
    ['DOUBTFUL', 'DOUBTFUL'],
    ['ECHO_SHIFT', 'ECHO_SHIFT'],
    ['ECHO_MASK', 'ECHO_MASK'],
  ]
  const prelude =
    constants.map(([name, source]) => `const ${name}: u32 = ${n.get(source)}u;\n`).join('') +
    `const PULLBACK: f32 = ${single(rustFloat(`${FIELD}/scene.rs`, 'PULLBACK'))};\n`
  return [
    prelude,
    wgslOf(`${FLATTEN_GPU}/scene_words.wgsl`),
    wgslOf(`${SHELL_GPU}/tree.wgsl`),
    wgslOf(`${FIELD}/gpu/field.wgsl`),
  ].join('')
}

/** `text` as the body of a template literal. */
const inTemplate = (text: string) => text.replace(/[`\\]|\$\{/g, (c) => `\\${c}`)

/** The kernel's module for the browser: the program, and the numbers the host reads by. */
export function distanceFieldKernelTs() {
  const n = layout()
  const wgsl = program(n)
  const sources = [
    PROXY,
    `${FLATTEN_GPU}/layout.rs`,
    `${FLATTEN_GPU}/scene_words.wgsl`,
    `${SHELL_GPU}/layout.rs`,
    `${SHELL_GPU}/tree.wgsl`,
    `${FIELD}/scene.rs`,
    `${FIELD}/gpu/layout.rs`,
    `${FIELD}/gpu/field.wgsl`,
  ]
  const number = (name: string, doc: string) =>
    `/** ${doc} */\nexport const DISTANCE_FIELD_KERNEL_${name} = ${n.get(name)}`
  return `${header(sources, '//')}

/** The program the compiler measures a mesh's voxels with, as it assembles it (\`distance_field/gpu.rs\`). */
export const DISTANCE_FIELD_KERNEL_WGSL = \`${inTemplate(wgsl)}\`

${number('NONE', 'What a node link or a span holds when it names nothing.')}

${number('WORKGROUP', 'Invocations per workgroup.')}

${number('BATCH', 'The most voxels one batch holds.')}

${number('MAX_DEPTH', 'The deepest tree the walk holds, in edges.')}

${number('MIP_RECORDS', 'The records of a mip volume, in `vec4`.')}

${number('DOUBTFUL', 'The bit of a voxel second word set when a step was in doubt.')}

${number('ECHO_SHIFT', 'Where the echo of the point a voxel read sits in its second word.')}

${number('ECHO_MASK', 'The echo bits once shifted down.')}

/** The head of the scene, in words (two \`vec4\` records). */
export const DISTANCE_FIELD_KERNEL_HEAD_WORDS = ${4 * n.get('HEAD_RECORDS')!}

/** The doubt, as a share of the largest coordinate the kernel rounds. */
export const DISTANCE_FIELD_KERNEL_DOUBT = ${rustFloat(`${FIELD}/gpu/layout.rs`, 'DOUBT')}

/** The share of a ray's length a start is pulled back by. */
export const DISTANCE_FIELD_KERNEL_PULLBACK = ${rustFloat(`${FIELD}/scene.rs`, 'PULLBACK')}
`
}
