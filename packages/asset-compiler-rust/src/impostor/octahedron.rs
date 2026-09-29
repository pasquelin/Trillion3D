//! The octahedral mapping of the impostor atlas (#817): direction to grid and back, the plane of
//! each captured frame, and the three frames a view blends. Object space, +Y up, pivot at the
//! bounding-sphere centre. The runtime card (#483) reads the atlas through the same formulas.
use crate::proxy::tracer::normalise as unit;
use crate::shared_math::cross;

/// ±1, never 0: the fold of the lower half needs a side even on an axis, where `sign(0) = 0`
/// would send the direction to the wrong face.
fn side(x: f64) -> f64 {
    if x < 0.0 {
        -1.0
    } else {
        1.0
    }
}

/// Direction `d` to the plane `[-1, 1]²`: the full octahedron, or the upper hemi-octahedron
/// (`hemi`), where a direction below the horizon folds onto it.
#[cfg(test)]
pub(crate) fn encode(d: [f64; 3], hemi: bool) -> [f64; 2] {
    use crate::shared_math::scale;
    if hemi {
        let d = [d[0], d[1].max(0.0), d[2]];
        let norm = d[0].abs() + d[1] + d[2].abs();
        if norm <= 0.0 {
            return [0.0, 0.0];
        }
        let o = scale(d, 1.0 / norm);
        return [o[0] + o[2], o[2] - o[0]];
    }
    let o = scale(d, 1.0 / (d[0].abs() + d[1].abs() + d[2].abs()));
    if o[1] < 0.0 {
        return [
            side(o[0]) * (1.0 - o[2].abs()),
            side(o[2]) * (1.0 - o[0].abs()),
        ];
    }
    [o[0], o[2]]
}

/// Grid coordinates `f ∈ [0, 1]²` back to a unit direction, the inverse of `encode` read
/// through `f = uv·½ + ½`.
pub(crate) fn decode(f: [f64; 2], hemi: bool) -> [f64; 3] {
    if hemi {
        let (x, z) = (f[0] - f[1], f[0] + f[1] - 1.0);
        return unit([x, 1.0 - x.abs() - z.abs(), z]);
    }
    let (u, v) = (f[0] * 2.0 - 1.0, f[1] * 2.0 - 1.0);
    let y = 1.0 - u.abs() - v.abs();
    if y < 0.0 {
        return unit([side(u) * (1.0 - v.abs()), y, side(v) * (1.0 - u.abs())]);
    }
    unit([u, y, v])
}

/// Direction of frame `(i, j)` of an `n`×`n` grid: the lattice vertex `(i, j) / (n − 1)`.
pub(crate) fn frame_direction((i, j): (usize, usize), n: usize, hemi: bool) -> [f64; 3] {
    let last = (n - 1) as f64;
    decode([i as f64 / last, j as f64 / last], hemi)
}

/// The capture plane of a frame looking back along `n`: its `x` and `y` axes, as the card's
/// shader builds them.
pub(crate) fn basis(n: [f64; 3]) -> ([f64; 3], [f64; 3]) {
    let up = if n[1].abs() > 0.999 {
        [0.0, 0.0, 1.0]
    } else {
        [0.0, 1.0, 0.0]
    };
    let x = unit(cross(up, n));
    (x, cross(n, x))
}

/// The three frames a view at grid position `g ∈ [0, n − 1]²` blends, and their weights: the
/// triangle of its grid cell that holds it, split along the diagonal, and its barycentric
/// coordinates there. The runtime card blends by this rule (#483); the bake proves it here.
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
