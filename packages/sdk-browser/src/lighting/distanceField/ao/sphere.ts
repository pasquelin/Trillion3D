import { hypot3 } from '../../../../../math/src/float/hypot.ts'
import { TAU } from '../../../../../math/src/constants.ts'
import { BOUNDING_SPHERE_RINGS } from './cones.ts'

/** The sides of the low-poly sphere that bounds a mesh (`stencilSphere`). */
const BOUNDING_SPHERE_SIDES = 4

/**
 * THE LOW-POLY SPHERE a mesh's bounds are drawn as (`dfaoObjectCullVs`): a unit sphere of `BOUNDING_SPHERE_SIDES`
 * arcs of `BOUNDING_SPHERE_RINGS` segments each about the z axis, one arc rotated into the next, `vec4f` a vertex
 * (the fourth lane one). The indices are of two triangles a quad of the arcs, and wind counter-clockwise seen from
 * outside, as the engine's front faces do: the draw culls the front faces, for the eye may be inside the sphere.
 */
export function stencilSphere() {
  const sides = BOUNDING_SPHERE_SIDES
  const rings = BOUNDING_SPHERE_RINGS
  const vertices = new Float32Array((sides + 1) * (rings + 1) * 4)
  for (let s = 0; s <= sides; s++) {
    const yaw = (TAU * s) / sides
    for (let v = 0; v <= rings; v++) {
      const angle = (v / rings) * (TAU / 2)
      const y = Math.sin(angle)
      const at = ((rings + 1) * s + v) * 4
      vertices[at] = -y * Math.sin(yaw)
      vertices[at + 1] = y * Math.cos(yaw)
      vertices[at + 2] = Math.cos(angle)
      vertices[at + 3] = 1
    }
  }
  const indices: number[] = []
  for (let s = 0; s < sides; s++) {
    const a0 = s * (rings + 1)
    const a1 = (s + 1) * (rings + 1)
    for (let r = 0; r < rings; r++)
      indices.push(a0 + r, a1 + r, a0 + r + 1, a1 + r, a1 + r + 1, a0 + r + 1)
  }
  if (!windsOutward(vertices, indices)) {
    for (let i = 0; i < indices.length; i += 3)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]]
  }
  return { vertices, indices: new Uint16Array(indices) }
}

/** Whether the first triangle of the list that has an area winds counter-clockwise seen from outside the sphere. */
function windsOutward(vertices: Float32Array, indices: readonly number[]) {
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]].map((v) => v * 4)
    const ab = [0, 1, 2].map((k) => vertices[b + k] - vertices[a + k])
    const ac = [0, 1, 2].map((k) => vertices[c + k] - vertices[a + k])
    const normal = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ]
    const area = hypot3(normal[0], normal[1], normal[2])
    if (area > 1e-6)
      return normal[0] * vertices[a] + normal[1] * vertices[a + 1] + normal[2] * vertices[a + 2] > 0
  }
  return true
}

/** The bounding sphere's vertex and index buffers (`stencilSphere`), uploaded once, labelled `label`. */
export function sphereBuffers(device: GPUDevice, label: string) {
  const sphere = stencilSphere()
  const vertices = device.createBuffer({
    label: `${label} sphere vertices`,
    size: sphere.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  const indices = device.createBuffer({
    label: `${label} sphere indices`,
    size: Math.ceil(sphere.indices.byteLength / 4) * 4,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(vertices, 0, sphere.vertices)
  device.queue.writeBuffer(indices, 0, sphere.indices)
  return { vertices, indices, indexCount: sphere.indices.length }
}
