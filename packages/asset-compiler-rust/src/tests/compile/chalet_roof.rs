//! The chalet's shingle roof, laid as the open world's `mountains` chalets lay it (#484): two
//! slopes of staggered boards, 0.6 m wide, 0.5 m long and 0.03 m thick, each lapped by a third of
//! its length, under a ridge cap. Every board is a closed box of its own: the roof is thousands of
//! disjoint parts, each smaller than a coarse level's error, which together cover a wide surface.
use super::chalet_fixture::{box_triangles, push_part, Triangle};
use super::silhouette::Mesh;

/// Ridge rise above the eaves and overhang past the walls.
const RISE: f32 = 2.6;
const OVERHANG: f32 = 1.0;
/// Board width and length along the slope, and its thickness.
const BOARD: [f32; 2] = [0.6, 0.5];
const THICKNESS: f32 = 0.03;

/// The roof over a `width` × `depth` footprint, eaves at `eaves`, ridge along X.
pub(super) fn shingle_roof(width: f32, depth: f32, eaves: f32) -> Mesh {
    let run = depth / 2.0 + OVERHANG;
    let angle = RISE.atan2(run);
    let slope = RISE.hypot(run);
    let along = width + 2.0 * OVERHANG;
    let [bw, bl] = BOARD;
    let lap = bl * (2.0 / 3.0);
    let rows = ((slope - bl) / lap).ceil() as usize + 1;
    let mut mesh = Mesh::default();
    for side in [1.0f32, -1.0] {
        for row in 0..rows {
            let s = (slope - bl / 2.0).min(bl / 2.0 + row as f32 * lap);
            let odd = (row % 2) as f32;
            let count = (along / bw).ceil() as usize + row % 2;
            let start = -along / 2.0 - odd * bw / 2.0 + bw / 2.0;
            for k in 0..count {
                let x =
                    (start + k as f32 * bw).clamp(-along / 2.0 + bw / 4.0, along / 2.0 - bw / 4.0);
                let y = eaves + RISE - s * angle.sin() + 0.02 + odd * 0.005;
                push_board(&mut mesh, [x, y, s * angle.cos()], angle, side);
            }
        }
    }
    let ridge = [along / 2.0, 0.06, 0.17];
    let centre = [0.0, eaves + RISE - 0.02 + 0.06, 0.0];
    let min = std::array::from_fn(|a| centre[a] - ridge[a]);
    let max = std::array::from_fn(|a| centre[a] + ridge[a]);
    push_part(&mut mesh, &box_triangles(min, max), centre);
    mesh
}

/// One board centred on `at`, pitched down the slope by `angle`, mirrored across the ridge when
/// `side` is negative.
fn push_board(mesh: &mut Mesh, at: [f32; 3], angle: f32, side: f32) {
    let [bw, bl] = BOARD;
    let half = [bw * 0.47, THICKNESS / 2.0, bl / 2.0];
    let local = box_triangles(half.map(|h| -h), half);
    let (sin, cos) = angle.sin_cos();
    let turn = |[x, y, z]: [f32; 3]| [x, y * cos - z * sin, (y * sin + z * cos) * side];
    let place = |p: [f32; 3]| {
        let [x, y, z] = turn(p);
        [x + at[0], y + at[1], z + at[2] * side]
    };
    let triangles: Vec<Triangle> = local
        .iter()
        .map(|t| t.map(|(p, n)| (place(p), turn(n))))
        .collect();
    push_part(mesh, &triangles, [at[0], at[1], at[2] * side]);
}
