/**
 * Trees grown for a closed stand, the ones a forest patch (`stands.ts`) packs by the dozen. A
 * tree of a closed stand is not the open-grown tree of the kit: its neighbours shade its lower
 * limbs off, so only the top of the stem carries a crown. Crown-ratio models of closed stands
 * (H. Hasenauer, R. A. Monserud, "A crown ratio model for Austrian forests", Forest Ecology and
 * Management 84, 1996) put that live crown at about half the height; the rest is a bare bole.
 *
 * Each species keeps the height and crown width of the kit's small tree (`trees.ts`), measured
 * from its mesh, and is drawn with few triangles: a tapered stem and sprays of leaf blades
 * (`branches.ts`), so a patch of fifty trees costs what two of the kit's trees do.
 */
import type { MeshPart, Vec3 } from '../plan/contract.ts';
import { blade, type Sheet } from './branches.ts';
import { meshPart, partBounds } from './geometry.ts';
import { hash01 } from './noise.ts';
import { palm } from './palm.ts';
import { tube } from './round.ts';
import { SURFACES } from './surfaces.ts';
import { tree, type TreeSpecies } from './trees.ts';
import { add, cross, unit } from './vector.ts';

/** Share of a stand tree's height that carries live crown (Hasenauer & Monserud 1996). */
const CROWN_RATIO = 0.5;

/** Height and crown radius of the kit's small tree of a species, metres, from its mesh. */
const shapes = new Map<TreeSpecies, { height: number; crown: number }>();
function kitShape(species: TreeSpecies) {
  let shape = shapes.get(species);
  if (!shape) {
    const [min, max] = partBounds(tree(species, 'small', 0).parts);
    shape = { height: max[1], crown: (max[0] - min[0] + max[2] - min[2]) / 4 };
    shapes.set(species, shape);
  }
  return shape;
}

/** Leaf sprays gathered for one part. */
const sheet = (): Sheet => ({ positions: [], indices: [] });

/** A spray: blades fanned about `dir` from `base`, each `length` long and a third as wide. */
function spray(out: Sheet, base: Vec3, dir: Vec3, length: number, blades: number, seed: number) {
  const side = unit(cross(dir, Math.abs(dir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0])),
    up = cross(side, dir);
  for (let b = 0; b < blades; b++) {
    const turn = (b / blades) * Math.PI + hash01(seed, b) * 0.4,
      face = unit(add(add([0, 0, 0], up, Math.cos(turn)), side, Math.sin(turn)));
    blade(out, base, dir, face, length * (0.8 + 0.3 * hash01(seed, b, 1)), length * 0.34);
  }
}

/** A conifer: a straight stem and whorls of drooping sprays, the lowest the widest. */
function conifer(seed: number): MeshPart[] {
  const { height, crown } = kitShape('pine'),
    base = height * (1 - CROWN_RATIO),
    whorls = 9,
    needles = sheet();
  for (let w = 0; w < whorls; w++) {
    const t = w / whorls,
      y = base + (height - base) * t * 0.95;
    for (let b = 0; b < 6; b++) {
      const a = w * 1.3 + b * 1.0472 + hash01(seed, w, b) * 0.5,
        reach = crown * (1 - t) + 0.3,
        dir = unit([Math.cos(a), -0.35, Math.sin(a)]);
      spray(needles, [0, y, 0], dir, reach, 3, seed + w * 8 + b);
    }
  }
  spray(needles, [0, height * 0.9, 0], [0, 1, 0], height * 0.12, 2, seed);
  return [
    tube(
      SURFACES.bark,
      [
        [0, 0, 0],
        [0, height * 0.5, 0],
        [0, height, 0],
      ],
      [0.14, 0.09, 0.02],
      {
        segments: 5,
      },
    ),
    meshPart(SURFACES.needles, needles.positions, needles.indices),
  ];
}

/** A broadleaf: a bole to mid-height, four limbs, a leaf cluster on each and one on top. */
function broadleaf(species: 'oak' | 'birch', seed: number): MeshPart[] {
  const { height, crown } = kitShape(species),
    base = height * (1 - CROWN_RATIO),
    birch = species === 'birch',
    leaves = sheet(),
    wood: MeshPart[] = [];
  const bark = birch ? SURFACES.birchBark : SURFACES.bark,
    radius = birch ? 0.09 : 0.16;
  wood.push(
    tube(
      bark,
      [
        [0, 0, 0],
        [0, base, 0],
        [0, height * 0.85, 0],
      ],
      [radius, radius * 0.7, 0.02],
      {
        segments: birch ? 5 : 6,
      },
    ),
  );
  const tips: Vec3[] = [[0, height * 0.88, 0]];
  for (let l = 0; l < 4; l++) {
    const a = l * 1.5708 + hash01(seed, l) * 0.8,
      out = crown * (birch ? 0.45 : 0.6),
      tip: Vec3 = [
        Math.cos(a) * out,
        base + (height - base) * (0.45 + 0.2 * hash01(seed, l, 1)),
        Math.sin(a) * out,
      ];
    wood.push(tube(bark, [[0, base, 0], tip], [radius * 0.45, 0.02], { segments: 4 }));
    tips.push(tip);
  }
  // Birch leaves hang in weeping sprays; oak leaves cover a rounded cluster.
  tips.forEach((tip, c) => {
    for (let k = 0; k < 10; k++) {
      const a = k * 2.39996 + c,
        rise = birch ? -0.8 : 0.9 - 1.6 * (k / 10),
        dir = unit([Math.cos(a), rise, Math.sin(a)]);
      spray(leaves, tip, dir, crown * (birch ? 0.45 : 0.5), 2, seed + c * 16 + k);
    }
  });
  return [
    ...wood,
    meshPart(birch ? SURFACES.birchLeaves : SURFACES.leaves, leaves.positions, leaves.indices),
  ];
}

/** One stand tree of `species`, rooted at the origin; `seed` varies its limbs and sprays. */
export function standTree(species: TreeSpecies, seed: number): MeshPart[] {
  if (species === 'pine') return conifer(seed);
  if (species === 'palm') return palm(kitShape('palm').height, seed, 'stand');
  return broadleaf(species, seed);
}

/** A low shrub of the understory, a metre high: sprays fanned up and out from its root. */
export function shrub(seed: number): MeshPart {
  const leaves = sheet();
  for (let k = 0; k < 6; k++) {
    const a = k * 1.0472 + hash01(seed, k) * 0.6;
    spray(leaves, [0, 0, 0], unit([Math.cos(a), 1.1, Math.sin(a)]), 1, 2, seed + k);
  }
  return meshPart(SURFACES.leaves, leaves.positions, leaves.indices);
}

/**
 * The height below a stand tree's crown, metres, measured on its mesh: the lowest point of its
 * leaves. A patch may bury that much of a stem on rising ground and still show every crown.
 */
export function boleHeight(species: TreeSpecies): number {
  const leaves = standTree(species, 0).filter((part) => part.surface.name.startsWith('card/'));
  return partBounds(leaves)[0][1];
}
