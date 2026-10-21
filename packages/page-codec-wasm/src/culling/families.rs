//! Generated part families the hierarchy is proved on, natively (`culling/tests.rs`) and against
//! the SDK module (`golden/culling.rs`).
use super::CullingPart;
use trillion3d_math::sequence::random::xorshift64;

/// Generated parts: a row-major grid of `rows × columns`, the same grid by columns, a random soup
/// of `soup`, a strip of `strip` and a stack of `stack` coincident boxes, over two levels with roots
/// among them; then no part, and a lone root. Each part holds one to three ranks, laid end to end
/// in the family's order.
/// The families' sizes the hierarchy's tests build.
pub(crate) const FAMILIES: [usize; 5] = [40, 25, 700, 300, 90];

pub(crate) fn families([rows, columns, soup, strip, stack]: [usize; 5]) -> Vec<Vec<CullingPart>> {
    let cluster = |x: f64, y: f64, z: f64, level: usize, root: bool| CullingPart {
        min: [x, y, z],
        max: [x + 1.0, y + 1.0, z + 0.1],
        level,
        sphere: [x + 0.5, y + 0.5, z, 2.0],
        min_error: level as f64 * 0.25,
        parent_error: if root {
            f64::INFINITY
        } else {
            0.5 + level as f64
        },
        first: 0,
        count: 0,
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
    let mut families = vec![
        grid(true),
        grid(false),
        soup,
        strip,
        stack,
        Vec::new(),
        vec![cluster(0.0, 0.0, 0.0, 0, true)],
    ];
    for parts in &mut families {
        let mut first = 0;
        for (k, part) in parts.iter_mut().enumerate() {
            (part.first, part.count) = (first, 1 + k % 3);
            first += part.count;
        }
    }
    families
}
