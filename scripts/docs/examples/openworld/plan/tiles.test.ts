import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { TERRAIN_BYTES } from './budget.ts';
import { COOK_COST, WORLD, type PropMesh } from './contract.ts';
import { createPlan } from './plan.ts';
import { SURFACE } from './surfaces.ts';
import { terrainTiles, type TileWindow } from './tiles.ts';

const plan = createPlan();
const TILES = WORLD.size / WORLD.tile;
const FLAT = new Set(
  [SURFACE.sea, SURFACE.river, SURFACE.lake, SURFACE.asphalt, SURFACE.dirt].map((s) => s.name),
);
const triangles = (mesh: PropMesh) =>
  mesh.parts.reduce((sum, part) => sum + part.indices.length / 3, 0);

function hash(meshes: readonly PropMesh[], images: ReadonlyMap<string, { rgba: Uint8Array }>) {
  const digest = createHash('sha256');
  for (const mesh of meshes)
    for (const part of mesh.parts)
      for (const data of [part.positions, part.normals!, part.uvs ?? [], part.indices])
        digest.update(JSON.stringify(part.surface)).update(new Uint8Array(Float32Array.from(data)));
  for (const [file, { rgba }] of images) digest.update(file).update(rgba);
  return digest.digest('hex');
}

/** One column (`axis` 0) or row (`axis` 1) of an RGBA image, as bytes. */
function edge({ size, rgba }: { size: number; rgba: Uint8Array }, axis: 0 | 1, at: number) {
  return Array.from({ length: size }, (_, k) => {
    const texel = axis === 0 ? k * size + at : at * size + k;
    return [...rgba.subarray(texel * 4, texel * 4 + 4)];
  });
}

/** The ground vertices a tile holds on one of its borders, as sorted "along:height" keys. */
function border(mesh: PropMesh, axis: 0 | 2, at: number) {
  const keys = new Set<string>();
  for (const part of mesh.parts) {
    if (FLAT.has(part.surface.name)) continue;
    for (let v = 0; v < part.positions.length; v += 3)
      if (part.positions[v + axis] === at)
        keys.add(`${part.positions[v + 2 - axis]}:${part.positions[v + 1]}`);
  }
  return [...keys].sort();
}

/** Asserts that every pair of neighbouring tiles holds the same border vertices. */
function assertNoCrack(meshes: readonly PropMesh[], window: TileWindow) {
  const byId = new Map(meshes.map((mesh) => [mesh.id, mesh])),
    tile = (tx: number, tz: number) => byId.get(`terrain/${tx}_${tz}`);
  let edges = 0;
  for (let tz = window.minTz; tz <= window.maxTz; tz++)
    for (let tx = window.minTx; tx <= window.maxTx; tx++) {
      const east = tile(tx + 1, tz),
        south = tile(tx, tz + 1);
      if (tx < window.maxTx && east) {
        assert.deepEqual(
          border(tile(tx, tz)!, 0, WORLD.tile),
          border(east, 0, 0),
          `${tx}_${tz} east`,
        );
        edges++;
      }
      if (tz < window.maxTz && south) {
        assert.deepEqual(
          border(tile(tx, tz)!, 2, WORLD.tile),
          border(south, 2, 0),
          `${tx}_${tz} south`,
        );
        edges++;
      }
    }
  return edges;
}

describe('open world terrain tiles', () => {
  // Three by three tiles on the south shore: two rows of land, the last reaching the sea.
  const coast: TileWindow = { minTx: 3, maxTx: 5, minTz: TILES - 4, maxTz: TILES - 2 },
    [x0, z0] = [coast.minTx, coast.minTz];

  it('builds the same bytes twice from the same plan, without a crack between its tiles', () => {
    const [first, second] = [terrainTiles(plan, [], coast), terrainTiles(plan, [], coast)];
    assert.equal(hash(first.meshes, first.textures), hash(second.meshes, second.textures));
    assert.equal(first.meshes.length, 9);
    assert.equal(assertNoCrack(first.meshes, coast), 12);
    // Neighbouring images bake their shared edge at the same world points: the same texels.
    const image = (tx: number, tz: number) => first.textures.get(`terrain-${tx}_${tz}.png`)!,
      last = first.stats.textureSize - 1;
    assert.deepEqual(edge(image(x0, z0), 0, last), edge(image(x0 + 1, z0), 0, 0));
    assert.deepEqual(edge(image(x0, z0), 1, last), edge(image(x0, z0 + 1), 1, 0));
    assert.ok(
      first.meshes.some((mesh) =>
        mesh.parts.some((part) => part.surface.name === SURFACE.sea.name),
      ),
    );
  });

  it('meets the terrain triangle budget over the whole map, one node per tile corner', (t) => {
    const whole = { minTx: 0, maxTx: TILES - 1, minTz: 0, maxTz: TILES - 1 },
      // No bake: the images are the window test's; this one weighs meshes and bytes.
      { meshes, instances, stats } = terrainTiles(plan, [], whole, false),
      total = meshes.reduce((sum, mesh) => sum + triangles(mesh), 0);
    t.diagnostic(`terrain: ${total} triangles, threshold ${stats.threshold.toFixed(4)} m`);
    assert.equal(meshes.length, TILES * TILES);
    assert.equal(total, stats.triangles);
    t.diagnostic(
      `${stats.textureSize}² texels a tile, ${stats.textureBytes} texture bytes, land edge ` +
        `mean ${stats.landEdge.mean.toFixed(1)} m, max ${stats.landEdge.max.toFixed(1)} m`,
    );
    const bytes = total * COOK_COST.bytesPerTriangle + stats.textureBytes;
    assert.ok(bytes <= TERRAIN_BYTES, `${bytes} bytes`);
    assert.ok(bytes > TERRAIN_BYTES * 0.95, `${bytes} bytes leave the budget unused`);
    // One ground part per tile; a baked one maps its image inside (0, 1), far below 1024.
    for (const mesh of meshes) {
      const [ground] = mesh.parts,
        uvs = ground.uvs ?? [];
      assert.equal(!!ground.surface.texture, uvs.length > 0, mesh.id);
      for (const uv of uvs) assert.ok(uv > 0 && uv < 1, `${mesh.id}: ${uv}`);
    }
    for (const instance of instances) {
      const [, tx, tz] = /(\d+)_(\d+)$/.exec(instance.prop)!.map(Number);
      assert.deepEqual(instance.position, [
        -WORLD.size / 2 + tx * WORLD.tile,
        0,
        -WORLD.size / 2 + tz * WORLD.tile,
      ]);
    }
    assert.equal(assertNoCrack(meshes, whole), 2 * TILES * (TILES - 1));
  });
});
