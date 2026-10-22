//! The frame a merged mesh's normal map is written in: the frame the engine rebuilds for a
//! triangle without tangents from its texture coordinates (`cluster/cotangentFrameWgsl.ts`), which
//! a simplified layer's transfer reads its sources' normals over (`simplify/transfer/read.rs`);
//! the GPU bake writes a tile's normals in it (`gpu/tile.wgsl`'s `cotangent`).
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{add, dot, scale};

/// The cotangent frame about `n` of a triangle of edges `e1`, `e2` and texture deltas `d1`, `d2`:
/// `T` along `u`, `B` along `v`, both scaled by the longer's length.
pub(in crate::hlod) fn cotangent(
    n: [f64; 3],
    (e1, e2): ([f64; 3], [f64; 3]),
    (d1, d2): ([f64; 2], [f64; 2]),
) -> [[f64; 3]; 2] {
    let (p, q) = (cross(e2, n), cross(n, e1));
    let t = add(scale(p, d1[0]), scale(q, d2[0]));
    let b = add(scale(p, d1[1]), scale(q, d2[1]));
    let s = 1.0 / dot(t, t).max(dot(b, b)).max(1e-30).sqrt();
    [scale(t, s), scale(b, s)]
}
