// Page of the append-blend proof: a world draws a row of opaque meshes, then blended and
// transmissive geometries are added to the scene while its session runs (`placement/webgpuAppend.ts`,
// `webgpu/blend/growth.ts`), and the image is the one of a world opened on all of them at once. A
// generated scene: no file of the site.
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts'
import { material } from '../../../packages/sdk-core/src/world/material/index.ts'
import { Texture } from '../../../packages/sdk-core/src/world/texture/texture.ts'
import { joined, row, type World } from './appendProof.ts'

const ball = geometry.sphere(0.6, 16, 12)
const crate = geometry.box(0.9, 0.9, 0.9)
const drum = geometry.cylinder(0.5, 0.5, 1, 16)
const ring = geometry.torus(0.5, 0.2, 12, 16)
const opaque = material.meshStandard({ color: 0xb04a3a, roughness: 0.7 })
/** Blended: half its light passes, the opaque row shows through. */
const veil = (color: number) =>
  material.meshStandard({ color, roughness: 0.5, transparent: true, opacity: 0.5 })
/** Transmissive: the backdrop refracts through it. */
const glass = (color: number) =>
  material.meshPhysical({ color, roughness: 0.1, transmission: 1, thickness: 0.5, ior: 1.5 })

/** What a world draws before a case adds to it: the opaque row at the front, then `contents`. */
const held =
  (...contents: Array<(world: World) => void>) =>
  (world: World) => {
    row(world, ball, opaque, 2)
    for (const content of contents) content(world)
  }
const veils = (world: World) => row(world, crate, veil(0x3a7ab0), -1)
const glasses = (world: World) => row(world, ball, glass(0xd8e8ff), -3)

/** A blended geometry the session does not hold, in a session that draws blended meshes. */
export const runBlended = () =>
  joined(held(veils, glasses), (world) => row(world, drum, veil(0x70b03a), -5))

/** A transmissive geometry the session does not hold, in a session that draws one. */
export const runTransmissive = () =>
  joined(held(veils, glasses), (world) => row(world, ring, glass(0xffe8d8), -7))

/** A blended and a transmissive geometry, one after the other, then a second material on a held
 *  blended geometry. */
export const runBoth = () =>
  joined(held(veils, glasses), (world) => {
    row(world, drum, veil(0x70b03a), -5)
    row(world, ring, glass(0xffe8d8), -7)
    row(world, crate, veil(0xb03a70), -9)
  })

/** A blended geometry in a session that draws none: the transparent pass is made for it. */
export const runBlendedFirst = () => joined(held(), (world) => row(world, drum, veil(0x70b03a), -5))

/** A transmissive geometry in a session opened without one: the water pass, its backdrop and its
 *  emission layer are made for it, as the open makes them. */
export const runTransmissiveFirst = () =>
  joined(held(veils), (world) => row(world, ring, glass(0xffe8d8), -7))

/** The same, in a session that draws nothing transparent. */
export const runTransmissiveAlone = () =>
  joined(held(), (world) => row(world, ring, glass(0xffe8d8), -7))

/** A geometry whose surface emits, in a session none of whose surfaces does: the emission layer
 *  is written from then on. */
export const runEmissive = () =>
  joined(held(), (world) =>
    row(world, ring, material.meshStandard({ color: 0x202020, emissive: 0xff8030 }), -7),
  )

/** A geometry wearing a texture, in a session that wears none: the feedback target is made. */
export const runTextured = () =>
  joined(held(), (world) => {
    const data = new Uint8Array(8 * 8 * 4)
    for (let i = 0; i < 64; i++)
      data.set(((i >> 3) + i) & 1 ? [250, 220, 60, 255] : [40, 90, 200, 255], i * 4)
    const map = new Texture({ data, width: 8, height: 8 })
    row(world, crate, material.meshStandard({ color: 0xffffff, map }), -7)
  })
