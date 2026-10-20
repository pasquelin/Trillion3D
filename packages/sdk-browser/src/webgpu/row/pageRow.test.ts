// Shared formulae lot: packedRowBase, factored out of 2 copies (first write of a row and the
// compact that moves it).
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { packedRowBase } from './pageRow.ts'
import { emptyGeometryBlock, rowGeometry, type MaterialLayers } from './pageRowMaterial.ts'
import { rowFlags, surfaceRow } from './surfaceRow.ts'
import type { VisMaterial } from '../../visibility/materialType.ts'
import { FLAG_COLOR, FLAG_UV } from '../../../../sdk-core/src/page/format.ts'
import {
  FLAG_BACK,
  FLAG_CLUSTER_PAGE,
  FLAG_DOUBLE,
  FLAG_HAS_COLOR,
  FLAG_HAS_MAP,
  FLAG_HAS_NORMAL,
  FLAG_SAMPLED,
  FLAG_VOXEL,
} from '../../visibility/types.ts'
import { GEOMETRY_VOXEL } from '../../../../sdk-core/src/page/voxelPage.ts'
import { VIS_TRIANGLE_BITS } from '../../visibility/visWords.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { PAGE_FILTER_SHIFT, PAGE_HEADER_WORDS, PAGE_SLOT_WORDS } from '../tile/pageTable.ts'
import { SAMPLE_MAG_NEAREST } from '../../texture/sampling.ts'
import { CLASS_FEATURE } from '../../visibility/shader/classWords.ts'
import { surfaceOf } from '../../page/surface.ts'

/** A row's flags and class: what its surface brings to it, on `geo`. */
const rowMaterial = (
  mat: VisMaterial,
  geo: Parameters<typeof rowFlags>[1],
  layers: MaterialLayers,
) => rowFlags(surfaceRow(mat, layers), geo, layers.textures)

test('packedRowBase shifts the rank by VIS_TRIANGLE_BITS bits, one rank further than the rank', () => {
  assert.equal(packedRowBase(0), 1 << VIS_TRIANGLE_BITS)
  assert.equal(packedRowBase(5), 6 << VIS_TRIANGLE_BITS)
})

test('packedRowBase at the first row (rank 0) reserves zero for the background', () => {
  assert.equal(packedRowBase(0), 256)
  assert.notEqual(packedRowBase(0), 0)
})

test('packedRowBase returns a 32-bit unsigned integer for a large rank', () => {
  const value = packedRowBase(0xffffff)
  assert.ok(Number.isInteger(value) && value >= 0)
  assert.equal(value, ((0xffffff + 1) << VIS_TRIANGLE_BITS) >>> 0)
})

// Where a row reads its geometry: the quantized page in its slot says which attributes it
// carries, and it carries no tangent — the resolve rebuilds the frame from the triangle.
test('a row over a quantized page takes its attributes from the page, never a tangent', () => {
  const block = emptyGeometryBlock()
  const source = {
    vertexBase: 7,
    count: 3,
    hasUv: true,
    hasNormal: true,
    hasTangent: true,
    hasColor: false,
  }
  const attributes = {} as never
  const blocks = new Map([[attributes, source]])
  assert.equal(rowGeometry({ attributes }, blocks, block), source)
  const geometryPage = {
    url: 'g',
    sha256: 'g',
    bytes: 64,
    vertexCount: 3,
    indexCount: 3,
    flags: FLAG_UV,
    uncompressedBytes: 128,
  }
  const paged = rowGeometry({ attributes, geometryPage }, blocks, block)!
  assert.deepEqual(
    { ...paged },
    {
      vertexBase: 0,
      count: 3,
      hasUv: true,
      hasNormal: false,
      hasTangent: false,
      hasColor: false,
      // No second UV set: the page header says so (`FLAG_UV1`).
      hasUv1: false,
      quantized: true,
      voxel: false,
    },
  )
})

// The bit only says where the geometry is read; it never splits a resolve class in two.
test('the cluster-page flag rides the row without moving its material class', () => {
  const layers = { mapLayer: new Map(), dataLayer: new Map() }
  const material = surfaceOf(G.standardSurface())
  const source = {
    vertexBase: 0,
    count: 3,
    hasUv: true,
    hasNormal: true,
    hasTangent: false,
    hasColor: false,
  }
  const plain = rowMaterial(material, source, layers)
  const paged = rowMaterial(material, { ...source, quantized: true }, layers)
  assert.equal(paged.classKey, plain.classKey)
  assert.equal(paged.flags, plain.flags | FLAG_CLUSTER_PAGE)
})

// Whether a page runs the filter rule is the page's, read off its maps' headers,
// never tested per sample: a page whose maps are all at the default carries no `FLAG_SAMPLED`,
// and its resolve class compiles the default read alone.
test('a page takes the filter rule, and its class, only when one of its maps has a filter word', () => {
  const map = {} as Texture,
    normal = {} as Texture
  const material = { ...surfaceOf(G.standardSurface()), map, normalMap: normal }
  const source = {
    vertexBase: 0,
    count: 3,
    hasUv: true,
    hasNormal: true,
    hasTangent: false,
    hasColor: false,
  }
  // Two page tables, four slots each; slot 3 of the data table is the normal map's.
  const tables = { color: new Uint32Array(64), data: new Uint32Array(64) }
  const layers = {
    mapLayer: new Map([[map, 1]]),
    dataLayer: new Map([[normal, 3]]),
    textures: {
      color: { pages: { words: tables.color } },
      data: { pages: { words: tables.data } },
    },
  }
  const plain = rowMaterial(material, source, layers)
  assert.equal(plain.flags & FLAG_SAMPLED, 0)
  assert.equal(plain.classKey & CLASS_FEATURE.HAS_SAMPLING, 0)
  tables.data[PAGE_HEADER_WORDS + 3 * PAGE_SLOT_WORDS + 2] = SAMPLE_MAG_NEAREST << PAGE_FILTER_SHIFT
  const sampled = rowMaterial(material, source, layers)
  assert.equal(sampled.flags, plain.flags | FLAG_SAMPLED, 'its normal map is filtered')
  assert.equal(sampled.classKey, plain.classKey | CLASS_FEATURE.HAS_SAMPLING)
})

// A page that carries `COLOR_0` — a runtime cut, a compiled glTF — is drawn with its vertex
// colours when its material asks for them, as the forward path draws it; any other row keeps the
// flags and the class it had, so nothing it draws moves.
test('a row multiplies by its vertex colours only when the material asks and the page has some', () => {
  const layers = { mapLayer: new Map(), dataLayer: new Map() }
  const block = emptyGeometryBlock()
  const page = (flags: number) =>
    rowGeometry(
      {
        attributes: {} as never,
        geometryPage: {
          url: 'g',
          sha256: 'g',
          bytes: 64,
          vertexCount: 3,
          indexCount: 3,
          flags,
          uncompressedBytes: 128,
        },
      },
      new Map(),
      block,
    )!
  const asks = surfaceOf(G.standardSurface({ vertexColors: true })),
    ignores = surfaceOf(G.standardSurface())
  assert.equal(asks.vertexColors, true)
  assert.equal(ignores.vertexColors, false)
  const plain = rowMaterial(ignores, { ...page(FLAG_UV) }, layers)
  const coloured = rowMaterial(asks, { ...page(FLAG_UV | FLAG_COLOR) }, layers)
  assert.equal(coloured.flags, plain.flags | FLAG_HAS_COLOR)
  assert.equal(coloured.classKey, plain.classKey | CLASS_FEATURE.HAS_VERTEX_COLOR)
  assert.deepEqual(rowMaterial(ignores, { ...page(FLAG_UV | FLAG_COLOR) }, layers), plain)
  assert.deepEqual(rowMaterial(asks, { ...page(FLAG_UV) }, layers), plain)
})

// A voxel brick is no quantized page: its row reads its bricks' boxes, carries its voxels' normals,
// draws its boxes' back faces alone (`rowSide`) — each pixel traced once, an eye inside a box
// too —, and wears its voxels' surface — none of its material's maps, whatever side its material
// draws.
test("a voxel brick's row reads its voxels, back faces alone, in the voxel class alone", () => {
  const map = {} as Texture
  const layers = { mapLayer: new Map([[map, 1]]), dataLayer: new Map() }
  const geometryPage = {
    ...{ url: 'v', sha256: 'v', bytes: 96, vertexCount: 24, indexCount: 24 },
    ...{ flags: GEOMETRY_VOXEL, uncompressedBytes: 96 },
  }
  const geo = rowGeometry(
    { attributes: {} as never, geometryPage },
    new Map(),
    emptyGeometryBlock(),
  )!
  assert.deepEqual([geo.voxel, geo.quantized, geo.hasNormal, geo.hasUv], [true, false, true, false])
  const row = rowMaterial({ ...surfaceOf(G.standardSurface()), map }, geo, layers)
  assert.equal(row.flags & (FLAG_HAS_MAP | FLAG_CLUSTER_PAGE), 0)
  assert.equal(
    row.flags & (FLAG_VOXEL | FLAG_DOUBLE | FLAG_BACK | FLAG_HAS_NORMAL),
    FLAG_VOXEL | FLAG_BACK | FLAG_HAS_NORMAL,
  )
  const f = CLASS_FEATURE
  assert.equal(row.classKey, f.VOXEL | f.HAS_VERTEX_NORMAL)
})
