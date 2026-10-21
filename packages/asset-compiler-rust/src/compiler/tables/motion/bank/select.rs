//! What an instanced skinned object may play, read from its node: whether its node can be banked
//! and the box of its mesh, the animation its settings choose, and the item's bounds scaled about
//! their centre.
use super::poses::moves;
use super::*;
use crate::compiler::args::objects::{ClipChoice, SkinnedInstance};
use trillion3d_math::geometry::aabb::centre;

/// Index field `field` of node `declared`, none when it leaves it out.
pub(super) fn index(declared: &Value, field: &str) -> Result<Option<usize>> {
    (declared.get(field))
        .map(|value| required_index(Some(value), field))
        .transpose()
}

/// The box of mesh `mesh` that node `declared` draws, when the node can be banked; `Err` with why
/// not: it has children, which would follow a skeleton the bank leaves out, or its mesh morphs
/// (`morphing`, by mesh), or declares no box with its positions (`boxes`).
pub(super) fn bankable(
    declared: &Value,
    mesh: usize,
    (boxes, morphing): (&[Option<[f64; 6]>], &[bool]),
) -> std::result::Result<[f64; 6], &'static str> {
    let children = declared.get("children").and_then(Value::as_array);
    if children.is_some_and(|children| !children.is_empty()) {
        return Err("it has children");
    }
    if morphing.get(mesh).copied().unwrap_or(false) {
        return Err("its mesh has morph targets");
    }
    boxes
        .get(mesh)
        .copied()
        .flatten()
        .ok_or("its mesh declares no bounds")
}

/// The rank of the animation `instance` plays on `node`, whose skin's joints are `joints`: the one
/// its clip names — refused (`INVALID_OPTIONS`) when no animation of `animations` is so ranked or
/// named —, else the first that moves one of `joints`; none when no animation does.
pub(super) fn chosen(
    node: usize,
    instance: &SkinnedInstance,
    animations: &[Value],
    joints: &BTreeSet<usize>,
) -> Result<Option<usize>> {
    let what = format!("{OBJECT_SETTINGS_FIELD}: node {node}'s {SKINNED_INSTANCE_SETTING}.clip");
    match &instance.clip {
        Some(ClipChoice::Rank(rank)) if *rank < animations.len() => Ok(Some(*rank)),
        Some(ClipChoice::Rank(rank)) => Err(OPTIONS.bad(format!(
            "{what} {rank} names no animation: the document has {}",
            animations.len()
        ))),
        Some(ClipChoice::Name(name)) => (animations.iter())
            .position(|animation| {
                animation.get("name").and_then(Value::as_str) == Some(name.as_str())
            })
            .map(Some)
            .ok_or_else(|| OPTIONS.bad(format!("{what} {name:?} names no animation"))),
        None => Ok(animations
            .iter()
            .position(|animation| moves(animation, joints))),
    }
}

/// `bounds` with its half extent times `scale` about its centre.
pub(super) fn scaled(bounds: &[f64; 6], scale: f64) -> [f64; 6] {
    let (low, high) = (
        [bounds[0], bounds[1], bounds[2]],
        [bounds[3], bounds[4], bounds[5]],
    );
    let middle = centre(low, high);
    let half: [f64; 3] = std::array::from_fn(|axis| (high[axis] - low[axis]) * 0.5 * scale);
    std::array::from_fn(|at| {
        if at < 3 {
            middle[at] - half[at]
        } else {
            middle[at - 3] + half[at - 3]
        }
    })
}
