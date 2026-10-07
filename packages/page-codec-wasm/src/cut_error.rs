//! The cut's projected error of a node's ceiling, to the bits of its JavaScript counterparts: the
//! certified screen error (`packages/sdk-core/src/lod/screenErrorBound.ts::clusterErrorAtDepth`,
//! through `packages/sdk-browser/src/page/selection/projection.ts::projectedErrorAt`) of a node's
//! sphere (`packages/sdk-browser/src/page/selection/frame.fixture.ts::frameClusterError`). Same
//! operands, same order, parentheses included; `math.rs` says why f64 arithmetic then yields the
//! same bits on both sides. The bits are pinned on one table both sides read
//! (`packages/sdk-core/src/lod/screenErrorBits.json`: `cut_error_tests.rs` here,
//! `screenErrorBits.test.ts` there). Its user is the compiler's screen audit
//! (`packages/asset-compiler-rust/src/geometry_page_quant/screen/tests.rs`).
//!
//! The negated comparisons are the JavaScript ones: `!(x > 0)` holds on NaN where `x <= 0` does not.
#![allow(clippy::neg_cmp_op_on_partial_ord)]

/// `clusterErrorAtDepth` refused its parameters: the JavaScript cut throws there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Invalid;

/// What the projection reads of the frame: the view elements and the lens scalars of
/// `SelectionState`.
pub struct Lens {
    pub view: [f64; 16],
    pub stretch: f64,
    pub focal: f64,
    pub near: f64,
    pub perspective: f64,
}

/// `viewDepthOf` of the point at `at`: `−view(p).z`.
fn view_depth(v: &[f64], at: usize, e: &[f64; 16]) -> f64 {
    -(e[2] * v[at] + e[6] * v[at + 1] + e[10] * v[at + 2] + e[14])
}

/// `viewLateralOf` of the point at `at`: its distance to the view axis.
fn view_lateral(v: &[f64], at: usize, e: &[f64; 16]) -> f64 {
    let vx = e[0] * v[at] + e[4] * v[at + 1] + e[8] * v[at + 2] + e[12];
    let vy = e[1] * v[at] + e[5] * v[at + 1] + e[9] * v[at + 2] + e[13];
    (vx * vx + vy * vy).sqrt()
}

/// `clipWeight`: the clip w of a view depth.
fn clip_weight(perspective: f64, depth: f64) -> f64 {
    perspective * depth + (1.0 - perspective)
}

/// `projectedErrorAt`, through `clusterErrorAtDepth` and its certified `screenErrorBound`.
fn projected_error_at(
    error: f64,
    lateral: f64,
    depth: f64,
    radius: f64,
    l: &Lens,
) -> Result<f64, Invalid> {
    if error == 0.0 {
        return Ok(0.0);
    }
    if error == f64::INFINITY {
        return Ok(f64::INFINITY);
    }
    let (stretch, focal, near, p) = (l.stretch, l.focal, l.near, l.perspective);
    let sound = |x: f64| x.is_finite() && x >= 0.0;
    let positive = |x: f64| x.is_finite() && x > 0.0;
    if !sound(error)
        || !sound(stretch)
        || !sound(radius)
        || !positive(focal)
        || !positive(near)
        || !(0.0..f64::INFINITY).contains(&lateral)
        || !depth.is_finite()
        || !(0.0..=1.0).contains(&p)
    {
        return Err(Invalid);
    }
    let reach = radius * stretch;
    let shift = error * stretch;
    let nearest = clip_weight(p, depth - reach);
    let closest = nearest - p * shift;
    let side = p * (lateral + reach);
    if !(closest > p * near) {
        return Ok(f64::INFINITY);
    }
    let slant = (nearest * nearest + side * side).sqrt();
    if !(slant >= nearest && slant < f64::INFINITY) {
        return Ok(f64::INFINITY);
    }
    Ok(((shift * focal) / nearest) * (slant / closest))
}

/// `frameClusterError` of a node's manifest ceiling, its sphere at `at` in `nodes`.
pub fn node_ceiling_error(bound: f64, nodes: &[f64], at: usize, l: &Lens) -> Result<f64, Invalid> {
    if bound == 0.0 {
        return Ok(0.0);
    }
    if bound == f64::INFINITY {
        return Ok(f64::INFINITY);
    }
    let lateral = view_lateral(nodes, at, &l.view);
    projected_error_at(
        bound,
        lateral,
        view_depth(nodes, at, &l.view),
        nodes[at + 3],
        l,
    )
}

#[cfg(test)]
#[path = "cut_error_tests.rs"]
mod tests;
