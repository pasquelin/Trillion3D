//! Node tests of the CPU cut, to the bits of their JavaScript counterparts: the frustum box test
//! (`packages/sdk-core/src/math/frustum/box.ts::frustumClipBox`), the certified screen error
//! (`packages/sdk-core/src/lod/screenErrorBound.ts::clusterErrorAtDepth`), the subtree floor
//! (`packages/sdk-browser/src/page/selection/projection.ts::errorFloorAt`) and the node decision
//! (`packages/sdk-browser/src/page/cut/node.ts`). Same operands, same order, parentheses included;
//! `math.rs` says why f64 arithmetic then yields the same bits on both sides.
//!
//! The negated comparisons are the JavaScript ones: `!(x > 0)` holds on NaN where `x <= 0` does not.
#![allow(clippy::neg_cmp_op_on_partial_ord)]

/// Frustum planes, four floats each, six of them.
pub const PLANE_VALUES: usize = 24;
/// Floats per node bound record and their fields (`packages/sdk-browser/src/page/cut/bounds.ts`).
pub const BOUND_STRIDE: usize = 13;
const OWN_FLOOR: usize = 0;
const OWN_CEIL: usize = 1;
const PARENT_FLOOR: usize = 2;
const OWN_SPHERE: usize = 3;
const PARENT_SPHERE: usize = 7;

/// `clusterErrorAtDepth` refused its parameters: the JavaScript cut throws there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Invalid;

/// What a node test reads of the frame: its planes in the root's space, the view elements, and
/// the lens scalars of `SelectionState`.
pub struct Lens {
    pub planes: [f64; PLANE_VALUES],
    pub view: [f64; 16],
    pub stretch: f64,
    pub focal: f64,
    pub near: f64,
    pub perspective: f64,
    pub pixel_error: f64,
    /// `flatExact`: a zero threshold decided without projecting.
    pub exact: bool,
}

/// `frustumClipBox`: 0 outside, 1 straddling, 2 inside. `b` is `minX, minY, minZ, maxX, maxY, maxZ`.
pub fn frustum_clip_box(planes: &[f64; PLANE_VALUES], b: &[f64]) -> u32 {
    let loaded = [b[0], b[3], b[1], b[4], b[2], b[5]];
    let side = |p: &[f64], forward: bool| {
        let pick = |n: f64, at: usize| loaded[at + usize::from((n > 0.0) == forward)];
        p[0] * pick(p[0], 0) + p[1] * pick(p[1], 2) + p[2] * pick(p[2], 4) + p[3] < 0.0
    };
    if planes.as_chunks::<4>().0.iter().any(|p| side(p, true)) {
        return 0;
    }
    if planes.as_chunks::<4>().0.iter().any(|p| side(p, false)) {
        return 1;
    }
    2
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

/// `errorFloorAt`.
fn error_floor_at(error: f64, depth: f64, radius: f64, l: &Lens) -> f64 {
    if error == 0.0 {
        return 0.0;
    }
    if error == f64::INFINITY {
        return f64::INFINITY;
    }
    if !(error > 0.0) || !(radius >= 0.0) {
        return 0.0;
    }
    let far = clip_weight(l.perspective, depth + radius * l.stretch);
    if !(far > 0.0) {
        return f64::INFINITY;
    }
    (error * l.stretch * l.focal) / far
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

/// `nodeDecision`: -1 reject, 1 accept, 0 undecided, on the bound record at `at`.
fn node_decision(v: &[f64], at: usize, l: &Lens) -> Result<i32, Invalid> {
    let own_radius = v[at + OWN_SPHERE + 3];
    let own_depth = view_depth(v, at + OWN_SPHERE, &l.view);
    if error_floor_at(v[at + OWN_FLOOR], own_depth, own_radius, l) > l.pixel_error {
        return Ok(-1);
    }
    let lateral = view_lateral(v, at + OWN_SPHERE, &l.view);
    if projected_error_at(v[at + OWN_CEIL], lateral, own_depth, own_radius, l)? > l.pixel_error {
        return Ok(0);
    }
    let parent_depth = view_depth(v, at + PARENT_SPHERE, &l.view);
    let floor = error_floor_at(
        v[at + PARENT_FLOOR],
        parent_depth,
        v[at + PARENT_SPHERE + 3],
        l,
    );
    Ok(i32::from(floor > l.pixel_error))
}

/// `floorAboveZero`.
fn floor_above_zero(v: &[f64], error: f64, radius_at: usize) -> bool {
    error == f64::INFINITY || (error > 0.0 && v[radius_at] >= 0.0)
}

/// `nodeDecisionAtZero`.
fn node_decision_at_zero(v: &[f64], at: usize) -> i32 {
    if floor_above_zero(v, v[at + OWN_FLOOR], at + OWN_SPHERE + 3) {
        return -1;
    }
    if v[at + OWN_CEIL] != 0.0 {
        return 0;
    }
    i32::from(floor_above_zero(
        v,
        v[at + PARENT_FLOOR],
        at + PARENT_SPHERE + 3,
    ))
}

/// `subtreeDecision` outside forcing, on the bound record of `node`.
pub fn subtree_decision(bounds: &[f64], node: usize, l: &Lens) -> Result<i32, Invalid> {
    let at = node * BOUND_STRIDE;
    if l.exact {
        Ok(node_decision_at_zero(bounds, at))
    } else {
        node_decision(bounds, at, l)
    }
}
