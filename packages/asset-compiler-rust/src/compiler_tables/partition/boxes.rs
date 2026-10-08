//! The boxes the partition is built from: each mesh's, as its primitives declare it with their
//! positions, and each placed node's, that box under its world matrix.
use super::*;
use trillion3d_math::aabb::{corner, extend_flat, EMPTY_FLAT};
use trillion3d_math::matrix::transform_point;

/// The box a primitive declares with its positions, or `None` when it declares none or morphs.
fn primitive_box(accessors: &[Value], primitive: &Value) -> Option<[f64; 6]> {
    if primitive
        .get("targets")
        .and_then(Value::as_array)
        .is_some_and(|targets| !targets.is_empty())
    {
        return None;
    }
    let rank = primitive.pointer("/attributes/POSITION")?.as_u64()? as usize;
    let accessor = accessors.get(rank)?;
    let side = |field: &str| -> Option<[f64; 3]> {
        let values: Vec<f64> = accessor
            .get(field)?
            .as_array()?
            .iter()
            .filter_map(Value::as_f64)
            .collect();
        let finite = values.len() == 3 && values.iter().all(|v| v.is_finite());
        finite.then(|| [values[0], values[1], values[2]])
    };
    let (min, max) = (side("min")?, side("max")?);
    Some([min[0], min[1], min[2], max[0], max[1], max[2]])
}

/// The box of each mesh, or `None` when one of its primitives declares none or morphs: a node
/// whose extent the compiler cannot bound stays in the core, read at once.
pub(super) fn mesh_boxes(g: &Value) -> Vec<Option<[f64; 6]>> {
    let accessors = g
        .get("accessors")
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice);
    let meshes = g
        .get("meshes")
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice);
    meshes
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

/// The world box of a local box under `world`: the eight corners transformed, then their union.
pub(super) fn world_box(world: &Mat4, local: &[f64; 6]) -> [f64; 6] {
    let mut out = EMPTY_FLAT;
    let (low, high) = (
        [local[0], local[1], local[2]],
        [local[3], local[4], local[5]],
    );
    for index in 0..8 {
        let p = corner(low, high, index);
        extend_flat(&mut out, transform_point(world, p));
    }
    out
}
