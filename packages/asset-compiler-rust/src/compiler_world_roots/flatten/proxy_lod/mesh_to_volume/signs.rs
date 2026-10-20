//! Internal neighbours and the intersection signs.
use super::super::grid::{
    add, leaf_offset, leaf_origin, local_coord, normalize, Coord, Grid, Leaf, COORD_OFFSETS, DIM,
    INVALID,
};
use super::IndexMesh;
use trillion3d_math::vecn::{dot, sub};
use trillion3d_page_codec::hash::WordMap;

/// Which of the 26 neighbours of voxel `pos` lie in its leaf.
fn internal_neighbours(pos: usize) -> [bool; 26] {
    let [x, y, z] = local_coord(pos);
    let mut m = [false; 26];
    m[0] = x != DIM - 1;
    m[1] = x != 0;
    m[2] = y != DIM - 1;
    m[3] = y != 0;
    m[4] = z != DIM - 1;
    m[5] = z != 0;
    m[6] = m[0] && m[5];
    m[7] = m[1] && m[5];
    m[8] = m[0] && m[4];
    m[9] = m[1] && m[4];
    m[10] = m[0] && m[2];
    m[11] = m[1] && m[2];
    m[12] = m[0] && m[3];
    m[13] = m[1] && m[3];
    m[14] = m[3] && m[4];
    m[15] = m[3] && m[5];
    m[16] = m[2] && m[4];
    m[17] = m[2] && m[5];
    m[18] = m[1] && m[3] && m[5];
    m[19] = m[1] && m[3] && m[4];
    m[20] = m[0] && m[3] && m[4];
    m[21] = m[0] && m[3] && m[5];
    m[22] = m[1] && m[2] && m[5];
    m[23] = m[1] && m[2] && m[4];
    m[24] = m[0] && m[2] && m[4];
    m[25] = m[0] && m[2] && m[5];
    m
}

/// The in-leaf offset read for each neighbour (`any_neighbour`), its sixth entry (i+1, j, k-1)
/// reading i+1, j, k: the field depends on that reading, kept as is.
const INTERNAL_OFFSETS: [isize; 26] = [
    64,
    -64,
    8,
    -8,
    1,
    -1,
    64,
    -64 - 1,
    64 + 1,
    -64 + 1,
    64 + 8,
    -64 + 8,
    64 - 8,
    -64 - 8,
    -8 + 1,
    -8 - 1,
    8 + 1,
    8 - 1,
    -64 - 8 - 1,
    -64 - 8 + 1,
    64 - 8 + 1,
    64 - 8 - 1,
    -64 + 8 - 1,
    -64 + 8 + 1,
    64 + 8 + 1,
    64 + 8 - 1,
];

/// The order `any_neighbour` visits the in-leaf neighbours in.
const INTERNAL_ORDER: [usize; 26] = [
    5, 4, 3, 2, 1, 0, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
];

/// Whether a neighbour of voxel `pos` passes `check`: in the leaf, then across it through the
/// tree.
pub(super) fn any_neighbour(
    grid: &Grid,
    leaf: &Leaf,
    pos: usize,
    check: impl Fn(f32) -> bool,
) -> bool {
    let mask = internal_neighbours(pos);
    for m in INTERNAL_ORDER {
        if mask[m] && check(leaf.dist[(pos as isize + INTERNAL_OFFSETS[m]) as usize]) {
            return true;
        }
    }
    let ijk = add(leaf.origin, local_coord(pos));
    (0..26).any(|m| !mask[m] && check(grid.value(add(ijk, COORD_OFFSETS[m]))))
}

/// The crossed inside voxels that an outside
/// neighbour sees in front of its closest polygon.
pub(super) fn intersecting_signs(grid: &Grid, mesh: &IndexMesh, leaf: &Leaf) -> Vec<usize> {
    let mut flips = Vec::new();
    let mut cache: WordMap<usize, ([f64; 3], [f64; 3])> = WordMap::default();
    let node_max = add(leaf.origin, [DIM - 1; 3]);
    for pos in leaf.on.ons() {
        let dist = leaf.dist[pos];
        if dist < 0.0 || dist > 0.75 {
            continue;
        }
        let ijk = add(leaf.origin, local_coord(pos));
        let xyz = ijk.map(f64::from);
        let lo: Coord = std::array::from_fn(|k| (ijk[k] - 1).max(leaf.origin[k]));
        let hi: Coord = std::array::from_fn(|k| (ijk[k] + 1).min(node_max[k]));
        let mut flip = false;
        'search: for nx in lo[0]..=hi[0] {
            for ny in lo[1]..=hi[1] {
                for nz in lo[2]..=hi[2] {
                    let npos = leaf_offset([nx, ny, nz]);
                    let poly = leaf.idx[npos];
                    if poly == INVALID || !(leaf.dist[npos] < -0.75) {
                        continue;
                    }
                    let (point, direction) = *cache.entry(npos).or_insert_with(|| {
                        let nxyz = [f64::from(nx), f64::from(ny), f64::from(nz)];
                        let point = mesh.closest_point(nxyz, poly);
                        (point, normalize(sub(nxyz, point), 1.0e-7))
                    });
                    if dot(direction, normalize(sub(xyz, point), 1.0e-7)) > 0.0 {
                        flip = true;
                        break 'search;
                    }
                }
            }
        }
        if !flip {
            let inside = |c: Coord| {
                (lo[0]..=hi[0]).contains(&c[0])
                    && (lo[1]..=hi[1]).contains(&c[1])
                    && (lo[2]..=hi[2]).contains(&c[2])
            };
            for offset in COORD_OFFSETS {
                let nijk = add(ijk, offset);
                if inside(nijk) {
                    continue;
                }
                let Some(neighbour) = grid.leaf(leaf_origin(nijk)) else {
                    continue;
                };
                let npos = leaf_offset(nijk);
                if !(neighbour.on.is_on(npos) && neighbour.dist[npos] < -0.75) {
                    continue;
                }
                let nxyz = nijk.map(f64::from);
                let cp = mesh.closest_point(nxyz, neighbour.idx[npos]);
                if dot(
                    normalize(sub(nxyz, cp), 1.0e-7),
                    normalize(sub(xyz, cp), 1.0e-7),
                ) > 0.0
                {
                    flip = true;
                    break;
                }
            }
        }
        if flip {
            flips.push(pos);
        }
    }
    flips
}
