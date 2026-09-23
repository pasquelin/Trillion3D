/**
 * The surface half of the prepared-scene check, proven on the two cases a rendered run refused
 * before they were fixed: the rank of two glTF textures the loader folds into one object, and the
 * sign of the second normal factor when the geometry loaded has no tangents.
 *
 * `materialDivergence` is compared directly rather than through a loaded scene: a folded texture
 * needs two decoded images, which a unit test has no business building, and the sign depends on
 * the geometry, not on the file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { foldImageRanks, materialDivergence } from './materials.ts';
import { hostSurface, hostTexture, tableMaterial, tableTexture } from './scene.fixture.ts';
import type { TableTexture } from '../../../sdk-core/src/index.ts';

const TRANSFORM = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** Twenty-one glTF textures, of which 2 and 20 share their image and their sampler: Emerald's
 *  case, where the loader publishes rank 2 for the object both of them became. */
const folded = (over: Partial<TableTexture> = {}) => {
  const textures = Array.from({ length: 21 }, (_, rank) => tableTexture({ image: rank }));
  textures[2] = tableTexture({ image: 7, ...over });
  textures[20] = tableTexture({ image: 7 });
  return textures;
};
const slot = { texture: 20, texCoord: 0, transform: TRANSFORM };

test('a slot naming either of two folded textures names the same record', () => {
  const actual = hostTexture();
  assert.equal(
    materialDivergence(
      tableMaterial({ map: slot }),
      hostSurface({ map: actual }),
      new Map([[actual, 2]]),
      folded(),
      true,
    ),
    null,
  );
});

test('a rank the table describes otherwise stays a named divergence', () => {
  const actual = hostTexture();
  assert.equal(
    materialDivergence(
      tableMaterial({ map: slot }),
      hostSurface({ map: actual }),
      new Map([[actual, 2]]),
      folded({ wrapS: 'clamp' }),
      true,
    ),
    'map names texture 2 where the table names 20',
  );
});

test('the sampler state of the named texture is compared', () => {
  const actual = hostTexture({ wrapT: 'clamp' });
  assert.equal(
    materialDivergence(
      tableMaterial({ map: slot }),
      hostSurface({ map: actual }),
      new Map([[actual, 20]]),
      folded(),
      true,
    ),
    'map wrapT clamp where the table says repeat',
  );
});

/**
 * The crates of the published example (#307): one image record per source material, all naming
 * the same file, and one sampler — the loader folds the three textures into the object it
 * publishes at rank 0, while the table names rank 1 for the second material. Read through the
 * sources, the two ranks are one image; read through the ranks of the records, they are not.
 */
const crates = (sources: string[], first: Partial<TableTexture> = {}) =>
  foldImageRanks(
    sources.map((_, rank) => tableTexture({ image: rank, ...(rank === 0 ? first : {}) })),
    sources,
  );

const NAMED = 'map names texture 0 where the table names 1';
const cases: {
  what: string;
  sources: string[];
  first?: Partial<TableTexture>;
  expected: string | null;
}[] = [
  { what: 'name one file are one image', sources: ['box1.png', 'box1.png'], expected: null },
  {
    what: 'name two files stay a named divergence',
    sources: ['box1.png', 'box2.png'],
    expected: NAMED,
  },
  // The fold rewrites the image rank alone: two records naming one file under two samplers are
  // still two textures for the loader, and `sameTexture` reads the sampler fields unfolded.
  {
    what: 'name one file under two samplers stay a named divergence',
    sources: ['box1.png', 'box1.png'],
    first: { wrapS: 'clamp' },
    expected: NAMED,
  },
];
for (const { what, sources, first, expected } of cases)
  test(`two image records that ${what}`, () => {
    const actual = hostTexture();
    assert.equal(
      materialDivergence(
        tableMaterial({ map: { texture: 1, texCoord: 0, transform: TRANSFORM } }),
        hostSurface({ map: actual }),
        new Map([[actual, 0]]),
        crates(sources, first),
        true,
      ),
      expected,
    );
  });

// The host flips the second normal factor when it rebuilds the tangent frame from screen
// derivatives (three.js issue 11438). The table says which variant it was written for; a reader
// whose geometry disagrees flips the sign back, and only the sign.
for (const written of ['with tangents', 'without tangents'] as const) {
  const derivativeTangents = written === 'without tangents';
  test(`a table written for geometry ${written} is read by geometry of the other kind`, () => {
    assert.equal(
      materialDivergence(
        tableMaterial({ derivativeTangents, normalScaleY: derivativeTangents ? -1 : 1 }),
        hostSurface({ normalScaleY: derivativeTangents ? 1 : -1 }),
        new Map(),
        [],
        !derivativeTangents,
      ),
      null,
    );
  });
}

test('a host that did not flip the sign where the table did is refused', () => {
  assert.equal(
    materialDivergence(
      tableMaterial({ derivativeTangents: false, normalScaleY: 1 }),
      hostSurface({ normalScaleY: 1 }),
      new Map(),
      [],
      true,
    ),
    'normalScaleY is 1 where the table says -1',
  );
});
