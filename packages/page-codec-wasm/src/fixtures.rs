//! Generated meshes the clusterer is proved on, here (`clusters_tests.rs`) and in the compiler's DAG
//! tests (`asset-compiler-rust/src/dag/tests/part17.rs`): one home for both crates' families.
use trillion3d_math::random::xorshift64;

/// A `side` × `side` grid of unit quads, listed by rows or by columns, its vertices shared.
pub fn grid(side: u32, by_columns: bool) -> (Vec<f32>, Vec<u32>) {
    let mut positions = Vec::new();
    for y in 0..=side {
        for x in 0..=side {
            positions.extend([x as f32, y as f32, 0.0]);
        }
    }
    let mut indices = Vec::new();
    for a in 0..side {
        for b in 0..side {
            let (x, y) = if by_columns { (a, b) } else { (b, a) };
            let v = y * (side + 1) + x;
            indices.extend([v, v + 1, v + side + 2, v, v + side + 2, v + side + 1]);
        }
    }
    (positions, indices)
}

/// `count` disjoint triangles in a random order over a cube: a soup, no vertex shared.
pub fn soup(count: u32, seed: u64) -> (Vec<f32>, Vec<u32>) {
    let mut state = seed;
    let mut positions = Vec::new();
    for _ in 0..count {
        let c = [0; 3].map(|_| (xorshift64(&mut state) % 10_000) as f32 / 100.0);
        positions.extend([
            c[0],
            c[1],
            c[2],
            c[0] + 0.3,
            c[1],
            c[2],
            c[0],
            c[1] + 0.3,
            c[2],
        ]);
    }
    (positions, (0..count * 3).collect())
}
