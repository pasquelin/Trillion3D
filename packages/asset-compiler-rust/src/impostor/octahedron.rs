//! The octahedral mapping of the impostor atlas: a direction is projected onto the
//! octahedron `|x| + |y| + |z| = 1`, the lower half folded over the upper one so the sphere fills a
//! square; this module maps direction to grid and back, gives the plane of each
//! captured frame, and picks the three frames a view blends. Object space, +Y up, pivot at the
//! bounding-sphere centre. The runtime card reads the atlas through the same formulas.
use trillion3d_math::octahedral::octahedral_decode;
use trillion3d_math::vec3::{cross, unit_or_itself};

/// Direction of frame `(i, j)` of an `n`×`n` grid: the lattice vertex `(i, j) / (n − 1)`.
pub(crate) fn frame_direction((i, j): (usize, usize), n: usize, hemi: bool) -> [f64; 3] {
    let last = (n - 1) as f64;
    octahedral_decode([i as f64 / last, j as f64 / last], hemi)
}

/// The capture plane of a frame looking back along `n`: its `x` and `y` axes, as the card's
/// shader builds them.
pub(crate) fn basis(n: [f64; 3]) -> ([f64; 3], [f64; 3]) {
    let up = if n[1].abs() > 0.999 {
        [0.0, 0.0, 1.0]
    } else {
        [0.0, 1.0, 0.0]
    };
    let x = unit_or_itself(cross(up, n));
    (x, cross(n, x))
}

/// The three frames a view at grid position `g ∈ [0, n − 1]²` blends, and their weights: the
/// triangle of its grid cell that holds it, split along the diagonal, and its barycentric
/// coordinates there. The runtime card blends by this rule; the bake proves it here.
#[cfg(test)]
pub(crate) fn cell_weights(g: [f64; 2], n: usize) -> [((usize, usize), f64); 3] {
    let last = (n - 1) as f64;
    let g0 = g.map(|x| x.floor().min(last - 1.0));
    let (fx, fy) = (g[0] - g0[0], g[1] - g0[1]);
    let (i, j) = (g0[0] as usize, g0[1] as usize);
    let middle = if fx > fy { (i + 1, j) } else { (i, j + 1) };
    [
        ((i, j), (1.0 - fx).min(1.0 - fy)),
        (middle, (fx - fy).abs()),
        ((i + 1, j + 1), fx.min(fy)),
    ]
}
