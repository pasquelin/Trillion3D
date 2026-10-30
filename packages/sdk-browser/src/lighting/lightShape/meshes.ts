import { TAU } from '../../../../math/src/constants.ts'

/**
 * THE MESHES OF THE LIGHT SHAPES' VISUALIZATION (`frame.ts`), one for each kind of local light, in the local frame the vertex stage deforms
 * (`lightShapeWgsl.ts`): the sphere of a point light, the cone of a spot (a ring of vertices for each section along its axis, the last
 * section past the rim, which the vertex stage folds back to the apex), the four sides of a rectangle light's box (the near half trimmed).
 * Each is a list of triangles; a wireframe draws their edges as lines, so the index list each mesh is drawn with is the three edges of every
 * triangle (`edgeIndices`), a shared edge drawn by each of its triangles.
 */

export interface LightShapeMesh {
  /** The vertices, three numbers each. */
  readonly vertices: Float32Array<ArrayBuffer>
  /** The triangles, three indices each. */
  readonly triangles: Uint16Array<ArrayBuffer>
}

/** The sphere of a point light: 16 rings of 32 slices on a sphere of radius 1, a pole's ring one vertex. */
export function pointMesh(): LightShapeMesh {
  const sections = 16,
    slices = sections * 2
  const vertexCount = (slices + 1) * (sections - 1) + slices * 2,
    triangleCount = slices * 2 * (sections - 2) + slices * 2
  const vertices = new Float32Array(vertexCount * 3)
  let at = 0
  for (let x = 0; x <= slices; x++) {
    const phi = (TAU / slices) * x
    const startY = x === slices ? 1 : 0,
      endY = sections - (x === slices ? 1 : 0)
    for (let y = startY; y <= endY; y++) {
      const theta = (Math.PI / sections) * y
      vertices.set(
        [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)],
        at,
      )
      at += 3
    }
  }
  const triangles = new Uint16Array(triangleCount * 3)
  let t = 0
  const add = (a: number, b: number, c: number) => {
    triangles[t++] = a
    triangles[t++] = b
    triangles[t++] = c
  }
  for (let x = 0; x < slices; x++) {
    const offset = (sections + 1) * x
    for (let y = 0; y < sections; y++) {
      const i0 = offset + y + 1
      const i1 = offset + y + (sections + 1) + (x === slices - 1 ? 0 : 1)
      const i2 = offset + y + (sections + 1) + (x === slices - 1 ? -1 : 0)
      const i3 = offset + y
      if (y === 0) add(i0, i1, i3)
      else if (y === sections - 1) add(i0, i2, i3)
      else {
        add(i0, i1, i3)
        add(i1, i2, i3)
      }
    }
  }
  return { vertices, triangles }
}

/** The cone of a spot light: 32 rays round the axis, 12 rings along it, the first coordinate the fraction of the cone's angle (up to 1.1, past the rim), the others the ring. */
export function spotMesh(): LightShapeMesh {
  const sections = 11,
    slices = 32,
    length = 1.1
  const vertexCount = (slices + 1) * (sections + 1)
  const vertices = new Float32Array(vertexCount * 3)
  let at = 0
  for (let x = 0; x <= slices; x++) {
    const phi = (TAU / slices) * x
    for (let y = 0; y <= sections; y++) {
      vertices.set([(length / sections) * y, Math.cos(phi), Math.sin(phi)], at)
      at += 3
    }
  }
  return { vertices, triangles: gridTriangles(slices, sections, sections + 1) }
}

/** The rectangle light's box: four sides of 14 strips, each 9 vertices across, trimmed to the part from the barn doors outward. */
export function rectMesh(): LightShapeMesh {
  const sectionsY = 14,
    sectionsX = sectionsY / 2 + 1,
    biasX = sectionsY - sectionsX
  const vertexCount = (sectionsX + 1) * (sectionsY * 4 + 1)
  const vertices = new Float32Array(vertexCount * 3)
  let at = 0
  for (let side = 0; side < 4; side++)
    for (let y = 0; y <= sectionsY + (side === 3 ? 0 : -1); y++)
      for (let x = 0; x <= sectionsX; x++) {
        const v = [0, 0, 0]
        v[0] = (1 / sectionsY) * (biasX + x) - 0.5
        v[(side % 2) + 1] = 0.5 * (side >= 2 ? -1 : 1)
        v[((side + 1) % 2) + 1] = ((1 / sectionsY) * y - 0.5) * (side === 1 || side === 2 ? -1 : 1)
        vertices.set(v, at)
        at += 3
      }
  const rows = sectionsX + 1
  const triangles = new Uint16Array(sectionsX * sectionsY * 4 * 2 * 3)
  let t = 0
  for (let side = 0; side < 4; side++) {
    const sideOffset = rows * sectionsY * side
    for (let y = 0; y < sectionsY; y++)
      for (let x = 0; x < sectionsX; x++) {
        const base = sideOffset + rows * y + x
        const i0 = base,
          i1 = base + 1,
          i2 = base + rows + 1,
          i3 = base + rows
        triangles.set([i0, i1, i3, i1, i2, i3], t)
        t += 6
      }
  }
  return { vertices, triangles }
}

/** The two triangles of each cell of a `slices` × `sections` grid whose rings are `stride` vertices apart. */
function gridTriangles(slices: number, sections: number, stride: number) {
  const triangles = new Uint16Array(slices * sections * 6)
  let t = 0
  for (let x = 0; x < slices; x++)
    for (let y = 0; y < sections; y++) {
      const offset = stride * x
      const i0 = offset + y,
        i1 = offset + y + 1,
        i2 = offset + y + stride + 1,
        i3 = offset + y + stride
      triangles.set([i0, i1, i3, i1, i2, i3], t)
      t += 6
    }
  return triangles
}

/** The edges of the triangles of `mesh` as a list of lines: three lines for each triangle, in the order of its corners. */
export function edgeIndices({ triangles }: LightShapeMesh) {
  const lines = new Uint16Array(triangles.length * 2)
  for (let t = 0; t < triangles.length; t += 3)
    lines.set(
      [
        triangles[t],
        triangles[t + 1],
        triangles[t + 1],
        triangles[t + 2],
        triangles[t + 2],
        triangles[t],
      ],
      t * 2,
    )
  return lines
}
