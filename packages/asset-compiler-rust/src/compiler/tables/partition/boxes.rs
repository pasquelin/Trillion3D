//! The boxes the partition is built from: each mesh's, as its primitives declare it with their
//! positions and their morph targets', each placed node's, that box under its world matrix
//! (`box_transform`, in `partition`), and a box carried from one frame into another's (`carried`).
use super::*;
use trillion3d_math::geometry::aabb::EMPTY_FLAT;
use trillion3d_math::geometry::box_transform::box_transform;
use trillion3d_math::matrix::linear::{determinant, linear_columns};
use trillion3d_math::matrix::multiply_matrix4;
use trillion3d_math::vector::vec3::{cross, divide};
use trillion3d_math::vector::vecn::dot;

/// `bounds` grown into the box `boxes` keeps under `key`, the box of a new key grown from the empty
/// one.
pub(crate) fn grown<K: Ord>(boxes: &mut BTreeMap<K, Box6>, key: K, bounds: &Box6) {
    grow_flat(boxes.entry(key).or_insert(EMPTY_FLAT), bounds);
}

/// The array `field` of `owner`, empty when it has none.
fn listed<'a>(owner: &'a Value, field: &str) -> &'a [Value] {
    owner
        .get(field)
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice)
}

/// The box a primitive declares with its positions, grown by each of its morph targets' position
/// offsets — the target's lowest offset added below where it is negative, its highest above where
/// it is positive —: the box holds the primitive under any weights between 0 and 1. `None` when it,
/// or one of its targets that moves its positions, declares no bounds.
fn primitive_box(accessors: &[Value], primitive: &Value) -> Option<[f64; 6]> {
    // The `min` or `max` of the POSITION accessor `attributes` names: three finite numbers.
    let side = |attributes: &Value, field: &str| -> Option<[f64; 3]> {
        let rank = attributes.get("POSITION")?.as_u64()? as usize;
        let values: Vec<f64> = (accessors.get(rank)?.get(field)?.as_array()?.iter())
            .filter_map(Value::as_f64)
            .collect();
        let finite = values.len() == 3 && values.iter().all(|v| v.is_finite());
        finite.then(|| [values[0], values[1], values[2]])
    };
    let attributes = primitive.get("attributes")?;
    let (mut min, mut max) = (side(attributes, "min")?, side(attributes, "max")?);
    let targets = listed(primitive, "targets").iter();
    for target in targets.filter(|t| t.get("POSITION").is_some()) {
        let (low, high) = (side(target, "min")?, side(target, "max")?);
        min = std::array::from_fn(|axis| min[axis] + low[axis].min(0.0));
        max = std::array::from_fn(|axis| max[axis] + high[axis].max(0.0));
    }
    Some([min[0], min[1], min[2], max[0], max[1], max[2]])
}

/// Whether each mesh morphs: one of its primitives declares a morph target. A node drawing it is
/// an animated object (`partition`), never an instanced skinned one (`motion/bank.rs`).
pub(crate) fn morphing(g: &Value) -> Vec<bool> {
    let meshes = listed(g, "meshes").iter();
    meshes
        .map(|mesh| (listed(mesh, "primitives").iter()).any(|p| !listed(p, "targets").is_empty()))
        .collect()
}

/// `bounds`, a box in the frame `from` places, in the frame `world` places: under
/// `world⁻¹ · from`. The inverse's linear part has, as its rows, the cross products of `world`'s
/// columns over its determinant, and as its translation that part applied to minus `world`'s.
/// `None` when `world` is flat: no frame of it holds the box.
pub(super) fn carried(bounds: &Box6, from: &Mat4, world: &Mat4) -> Option<Box6> {
    let det = determinant(world);
    if !(det.is_finite() && det != 0.0) {
        return None;
    }
    let [a0, a1, a2] = linear_columns(world);
    let rows = [cross(a1, a2), cross(a2, a0), cross(a0, a1)].map(|c| divide(c, det));
    let mut inverse = [0.0; 16];
    for (i, row) in rows.iter().enumerate() {
        for (k, value) in row.iter().enumerate() {
            inverse[4 * k + i] = *value;
        }
        inverse[12 + i] = -dot(*row, [world[12], world[13], world[14]]);
    }
    inverse[15] = 1.0;
    let mut out = EMPTY_FLAT;
    box_transform(&mut out, bounds, &multiply_matrix4(&inverse, from));
    Some(out)
}

/// The box of each mesh, its morph targets' offsets included (`primitive_box`), or `None` when one
/// of its primitives declares none: a node whose extent the compiler cannot bound stays in the
/// core, read at once.
pub(crate) fn mesh_boxes(g: &Value) -> Vec<Option<[f64; 6]>> {
    let accessors = listed(g, "accessors");
    listed(g, "meshes")
        .iter()
        .map(|mesh| {
            let primitives = mesh.get("primitives")?.as_array()?;
            let mut union = EMPTY_FLAT;
            for primitive in primitives {
                grow_flat(&mut union, &primitive_box(accessors, primitive)?);
            }
            (!primitives.is_empty()).then_some(union)
        })
        .collect()
}
