import { EngineError } from './cache.ts'
import { VOXEL_BRICK_BYTES, VOXEL_RECORD_BYTES, VOXEL_VERSION } from './writtenFormats.ts'

/**
 * The voxel far field the compiler writes (`asset-compiler-rust/src/voxel/stage.rs`): the coarsest
 * groups of a primitive's DAG, each drawn as sparse 4³ bricks of voxels where their error is below
 * its triangles', and above every primitive's roots one group of the whole mesh. `voxels.bin`,
 * little-endian: a head — `T3VX`, the version, the group count, the brick count —, a record per
 * group (`VoxelGroup`), then every brick, then every voxel (`voxel/bricks.rs`).
 */

/** The file's magic, `T3VX` read as a little-endian u32. */
const VOXEL_MAGIC = 0x58563354
/** Words of the head and of a group's record: six counts and ranks, three errors, the corner. */
const HEAD_WORDS = 4,
  GROUP_WORDS = 12

/** The manifest's `voxels` section: the file's layout and totals. */
export interface VoxelSection {
  /** Format version (`VOXEL_VERSION`). */ version: number
  /** The file holding every group, beside the manifest. */ file: string
  /** Its size. */ bytes: number
  /** Bytes of the head, a group, a brick and a voxel. */ headBytes: number
  /** Bytes of a group's record. */ groupBytes: number
  /** Bytes of a brick's record. */ brickBytes: number
  /** Bytes of a voxel's record. */ voxelBytes: number
  /** A group's error over its voxels' side. */ errorPerSide: number
  /** Groups in the file. */ groups: number
  /** Bricks in the file. */ bricks: number
  /** Voxels in the file. */ voxels: number
}

/** One group drawn as voxels: of a primitive's DAG (`primitive` its rank in the manifest, `group`
 *  its rank in the primitive's structure), or a mesh's far group (`primitive` null, `group` the
 *  compiled mesh), above every primitive's roots. */
export interface VoxelGroup {
  /** Rank of its primitive in the manifest; null for a far group. */ primitive: number | null
  /** Its DAG group, or its compiled mesh for a far group. */ group: number
  /** Its first brick in the file. */ firstBrick: number
  /** Its bricks. */ bricks: number
  /** Its first voxel in the file. */ firstVoxel: number
  /** Its voxels. */ voxels: number
  /** Its error, in object units: `errorPerSide` times its side. */ error: number
  /** The least error of the groups that replace it; infinite where none does. */ parentError: number
  /** Its voxels' side, in object units. */ side: number
  /** Object position of its first brick's corner. */ origin: [number, number, number]
}

/** A decoded `voxels.bin`: its groups, and where its bricks and voxels start. */
export type VoxelFile = {
  groups: VoxelGroup[]
  view: DataView
  brickBase: number
  voxelBase: number
}

/** A reason the section cannot be read, or null; an absent section is no error. */
function voxelSectionProblem(section: unknown) {
  if (section === undefined || section === null) return null
  if (typeof section !== 'object' || Array.isArray(section)) return 'the section is not an object'
  const value = section as Partial<VoxelSection>
  if (value.version !== VOXEL_VERSION)
    return `version ${String(value.version)} where ${VOXEL_VERSION} is expected`
  if (typeof value.file !== 'string' || !value.file) return 'it names no file'
  const layout = [
    [value.headBytes, HEAD_WORDS * 4],
    [value.groupBytes, GROUP_WORDS * 4],
    [value.brickBytes, VOXEL_BRICK_BYTES],
    [value.voxelBytes, VOXEL_RECORD_BYTES],
  ]
  if (layout.some(([read, known]) => read !== known)) return 'its record sizes are not this layout'
  return null
}

/** The `voxels` section, or undefined when the cache has none; an unknown one is refused by name. */
export function assertVoxelSection(section: unknown): VoxelSection | undefined {
  const problem = voxelSectionProblem(section)
  if (problem) throw new EngineError('UNSUPPORTED_FORMAT', `Cannot read voxels: ${problem}`, {})
  return (section ?? undefined) as VoxelSection | undefined
}

/** Group `g`'s record, read from `view` (`VoxelGroup`). */
function groupAt(view: DataView, g: number): VoxelGroup {
  const at = HEAD_WORDS * 4 + g * GROUP_WORDS * 4
  const word = (k: number) => view.getUint32(at + 4 * k, true),
    real = (k: number) => view.getFloat32(at + 4 * k, true)
  const primitive = word(0)
  return {
    primitive: primitive === 0xffffffff ? null : primitive,
    group: word(1),
    firstBrick: word(2),
    bricks: word(3),
    firstVoxel: word(4),
    voxels: word(5),
    error: real(6),
    parentError: real(7),
    side: real(8),
    origin: [real(9), real(10), real(11)],
  }
}

/** `voxels.bin` as `section` describes it: its head checked against the section, every group's
 *  bricks and voxels inside the file, refused by name otherwise. */
export function decodeVoxelFile(bytes: ArrayBuffer, section: VoxelSection): VoxelFile {
  const view = new DataView(bytes)
  const refuse = (why: string) => {
    throw new EngineError('INVALID_CACHE', `${section.file}: ${why}`, {})
  }
  if (bytes.byteLength !== section.bytes || bytes.byteLength < HEAD_WORDS * 4)
    refuse('its size is not the section')
  const [magic, version, groupCount, brickCount] = [0, 1, 2, 3].map((k) =>
    view.getUint32(4 * k, true),
  )
  if (magic !== VOXEL_MAGIC || version !== VOXEL_VERSION) refuse('its head is not a voxel file')
  if (groupCount !== section.groups || brickCount !== section.bricks)
    refuse('its counts are not the section')
  const brickBase = HEAD_WORDS * 4 + groupCount * GROUP_WORDS * 4,
    voxelBase = brickBase + brickCount * VOXEL_BRICK_BYTES
  if (voxelBase + section.voxels * VOXEL_RECORD_BYTES !== bytes.byteLength)
    refuse('its records do not fill it')
  const groups: VoxelGroup[] = []
  for (let g = 0; g < groupCount; g++) {
    const group = groupAt(view, g)
    if (group.firstBrick + group.bricks > brickCount) refuse(`group ${g} lies past its bricks`)
    if (group.firstVoxel + group.voxels > section.voxels) refuse(`group ${g} lies past its voxels`)
    if (!(group.side > 0) || !(group.error >= 0) || !(group.parentError >= group.error))
      refuse(`group ${g} has no error band`)
    groups.push(group)
  }
  return { groups, view, brickBase, voxelBase }
}
