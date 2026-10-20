//! Foliage: thousands of small parts that share no position, scattered over a relief or through a
//! crown and crossing one another, each under a texture island of its own — grass cards of two by
//! two quads, strips of four triangles, lone triangles, fans of leaves, as Emerald Square's
//! vegetation and Bistro's leaves are written. The spatial clustering cuts many parts between two clusters, so a fragment of a part,
//! one or two triangles, carries positions another group shares.
use super::shapes::{amplitude, Relief};
use super::*;
use crate::tests::fixtures::portable_sin;
use trillion3d_math::vec3::{cross, divide};
use trillion3d_math::vecn::length;

/// Parts scattered over the 64 × 64 relief.
const PARTS: usize = 2400;

/// The corners of one part in its own plane, `(across, up)` in `[0, 1]`, and its triangles.
fn part(kind: usize) -> (Vec<[f32; 2]>, Vec<u32>) {
    match kind {
        // A card of 2 × 2 quads: 9 corners, 8 triangles.
        0 => {
            let corners = (0..9).map(|v| [(v % 3) as f32 / 2.0, (v / 3) as f32 / 2.0]);
            let triangles = crate::tests::fixtures::grid_indices(2, 2, |x, y| (y * 3 + x) as u32);
            (corners.collect(), triangles)
        }
        // A strip of four triangles: 6 corners.
        1 => {
            let corners = (0..6).map(|v| [(v % 2) as f32, (v / 2) as f32 / 2.0]);
            let triangles = crate::tests::fixtures::grid_indices(1, 2, |x, y| (y * 2 + x) as u32);
            (corners.collect(), triangles)
        }
        // A lone triangle.
        _ => (vec![[0.0, 0.0], [1.0, 0.0], [0.5, 1.0]], vec![0, 1, 2]),
    }
}

/// Parts standing on the relief, each turned about the vertical, leaning and bent by the seed,
/// its corners its own: no two parts share a position, every part is one texture island and
/// lit from its own face.
pub(super) fn scattered_parts(seed: u64) -> Case {
    let mut rng = seeded(seed);
    let amplitude = amplitude(&mut rng);
    let relief = Relief::new(&mut rng, amplitude);
    // The parts' size against the clusters', drawn from the seed: from parts a cluster holds
    // whole to parts as wide as a cluster, most of them cut.
    let scale = 1.0 + rng.unit() * 2.0;
    let (mut positions, mut uv, mut normals, mut indices) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for _ in 0..PARTS {
        let (x, y) = (rng.unit() * 63.0, rng.unit() * 63.0);
        let ground = relief.at(x as usize, y as usize);
        let turn = rng.unit() * std::f32::consts::TAU;
        let (sin, cos) = (
            portable_sin(turn),
            portable_sin(turn + std::f32::consts::FRAC_PI_2),
        );
        let (width, height) = (
            scale * (2.0 + rng.unit() * 4.0),
            scale * (1.0 + rng.unit() * 1.5),
        );
        let (lean, bend) = (1.0 + rng.unit() * 2.0, rng.unit() * 0.6);
        let (corners, triangles) = part(rng.below(3));
        let first = (positions.len() / 3) as u32;
        for &[across, up] in &corners {
            let side = (across - 0.5) * width;
            // The middle column bows out of the part's plane: a curved card.
            let out = bend * portable_sin(across * std::f32::consts::PI) + lean * up * height;
            positions.extend([
                x + side * cos - out * sin,
                y + side * sin + out * cos,
                ground + up * height,
            ]);
            uv.extend([across, up]);
        }
        indices.extend(triangles.iter().map(|&c| first + c));
        // One normal per part, its first triangle's: flat-lit, front to its winding.
        let normal = triangle_normal(&positions, &indices[indices.len() - triangles.len()..]);
        normals.extend(corners.iter().flat_map(|_| normal));
    }
    let mut case = Case::new("foliage-scattered-parts", positions, indices);
    case.uv0 = Some(uv);
    case.normals = Some(normals);
    case
}

/// Leaves of a crown (`crown`).
const LEAVES: usize = 4000;

/// A tree's crown, 50 across: leaves 3 to 9 across scattered through it and crossing one another,
/// each a cupped fan of one to fourteen triangles turned every way, flat-shaded — a hard normal at
/// every edge —, under a texture island of its own. Its coarse levels reduce by pruning whole
/// leaves, and the last groups of a level share the leaves the grouping cut between them.
pub(super) fn crown(seed: u64) -> Case {
    let mut rng = seeded(seed);
    let radius = 25.0;
    let (mut positions, mut uv, mut normals, mut indices) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let angle = |rng: &mut Xorshift| rng.unit() * std::f32::consts::TAU;
    let (sin, cos) = (portable_sin, |t: f32| {
        portable_sin(t + std::f32::consts::FRAC_PI_2)
    });
    for _ in 0..LEAVES {
        // A point of the ball: a cube point, kept when inside.
        let centre = loop {
            let p = [0, 1, 2].map(|_| (rng.unit() * 2.0 - 1.0) * radius);
            if length(p) <= radius {
                break p;
            }
        };
        let (turn, tilt) = (angle(&mut rng), angle(&mut rng));
        let across = [cos(turn), sin(turn), 0.0];
        let up = [-sin(turn) * cos(tilt), cos(turn) * cos(tilt), sin(tilt)];
        let (size, fan, cup) = (3.0 + rng.unit() * 6.0, 1 + rng.below(14), rng.unit());
        let out = cross(across, up);
        let rim = (0..=fan).map(|k| k as f32 / fan as f32 * std::f32::consts::PI);
        let corners: Vec<[f32; 3]> = std::iter::once([0.0, 0.0, 0.0])
            .chain(rim.map(|t| [cos(t), sin(t), cup]))
            .collect();
        // Flat-shaded, each triangle its own corners: a hard normal at every edge of the leaf.
        for k in 1..=fan {
            let first = (positions.len() / 3) as u32;
            for c in [0, k, k + 1] {
                let [a, u, o] = corners[c];
                let at = |k: usize| centre[k] + size * (a * across[k] + u * up[k] + o * out[k]);
                positions.extend([0, 1, 2].map(at));
                uv.extend([0.5 + a * 0.5, u]);
            }
            indices.extend([first, first + 1, first + 2]);
            let normal = triangle_normal(&positions, &indices[indices.len() - 3..]);
            normals.extend([normal; 3].into_iter().flatten());
        }
    }
    let mut case = Case::new("foliage-crown", positions, indices);
    case.uv0 = Some(uv);
    case.normals = Some(normals);
    case
}

/// Unit normal of the first triangle of `corners`.
fn triangle_normal(positions: &[f32], corners: &[u32]) -> [f32; 3] {
    let p = |v: u32| [0, 1, 2].map(|k| positions[v as usize * 3 + k]);
    let (a, b, c) = (p(corners[0]), p(corners[1]), p(corners[2]));
    let n = cross(
        [0, 1, 2].map(|k| b[k] - a[k]),
        [0, 1, 2].map(|k| c[k] - a[k]),
    );
    divide(n, length(n))
}

pub(super) fn cases() -> Vec<(Generator, Expect)> {
    vec![
        (scattered_parts, Expect::ONE_ROOT),
        (crown, Expect::ONE_ROOT),
    ]
}
