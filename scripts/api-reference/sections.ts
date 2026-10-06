/** The folder a world module sits in, `/world/<folder>/`: the family it belongs to. */
const WORLD_FOLDER = /\/world\/([a-zA-Z]+)\//

/** A family's own file, `/world/api/<family>Family.ts`: the family it is, whatever folder it sits in. */
const FAMILY_FILE = /\/world\/api\/([a-zA-Z]+)Family\.ts$/

/** Low-level maths and the camera bridge built on them: the "Math utilities" section. */
const MATH =
  /\/src\/(?:math|hiz)\/(?!oracles\.ts$)|sdk-browser\/src\/camera\/(?:engineCamera|world)\.ts$/
/** The camera controllers `world.controls` makes: they belong with the cameras they move. */
const CONTROLS = /sdk-browser\/src\/camera\/controls\//
/** Compiling a model, and the jobs a compilation runs as: "Node and compilation". */
const NODE = /^packages\/sdk-node\/|\/runtime\/jobs\.ts$/

/**
 * The reference section of an export: the world family its file or folder names (the constant families
 * gathered under `constants`), then the maths, the Node compiler and, for every other public
 * symbol, `types`. `families` are the family names a world folder may carry.
 */
export function sectionOf(module: string, families: ReadonlySet<string>): string {
  const folder = FAMILY_FILE.exec(module)?.[1] ?? WORLD_FOLDER.exec(module)?.[1]
  if (folder === 'constants') return 'constants'
  if (folder) return families.has(folder) ? folder : 'world'
  if (CONTROLS.test(module)) return 'camera'
  if (MATH.test(module)) return 'math-utilities'
  if (NODE.test(module)) return 'node'
  return 'types'
}
