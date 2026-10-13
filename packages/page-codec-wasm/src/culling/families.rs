//! Generated cluster families the hierarchy is proved on, natively (`culling_tests.rs`) and against
//! the SDK module (`golden_tests/culling.rs`).
use super::CullingCluster;
use trillion3d_math::random::xorshift64;

/// Generated clusters: a row-major grid of `rows × columns`, the same grid by columns, a random soup
/// of `soup`, a strip of `strip` and a stack of `stack` coincident boxes, over two levels with roots
/// among them; then no cluster, and a lone root.
/// The families' sizes the hierarchy's tests build.
pub(crate) const FAMILIES: [usize; 5] = [40, 25, 700, 300, 90];

pub(crate) fn families(
    [rows, columns, soup, strip, stack]: [usize; 5],
) -> Vec<Vec<CullingCluster>> {
    let cluster = |x: f64, y: f64, z: f64, level: usize, root: bool| CullingCluster {
        min: [x, y, z],
        max: [x + 1.0, y + 1.0, z + 0.1],
        level,
        parent_sphere: [x + 0.5, y + 0.5, z, 2.0],
        parent_error: if root {
            f64::INFINITY
        } else {
            0.5 + level as f64
        },
    };
    let grid = |by_rows: bool| {
        let mut out = Vec::new();
        for a in 0..rows {
            for b in 0..columns {
                let (x, y) = if by_rows { (b, a) } else { (a, b) };
                out.push(cluster(x as f64, y as f64, 0.0, (a + b) % 2, a == 0));
            }
        }
        out
    };
    let mut state = 9u64;
    let soup = (0..soup)
        .map(|_| {
            let [x, y, z] = [0; 3].map(|_| {
                xorshift64(&mut state);
                (state % 10_000) as f64 / 100.0
            });
            cluster(x, y, z, 0, false)
        })
        .collect();
    let strip = (0..strip)
        .map(|k| cluster(k as f64, 0.0, 0.0, 0, k % 7 == 0))
        .collect();
    let stack = (0..stack)
        .map(|_| cluster(3.0, 3.0, 3.0, 1, false))
        .collect();
    vec![
        grid(true),
        grid(false),
        soup,
        strip,
        stack,
        Vec::new(),
        vec![cluster(0.0, 0.0, 0.0, 0, true)],
    ]
}
