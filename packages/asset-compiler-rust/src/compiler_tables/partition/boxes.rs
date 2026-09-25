//! The boxes the partition is built from: each mesh's, as its primitives declare it with their
//! positions, and each placed node's, that box under its world matrix.
use super::*;

/// A box no point is in yet: low bounds at `+∞`, high at `−∞`.
pub(super) const EMPTY: [f64; 6] = [
    f64::INFINITY,
    f64::INFINITY,
    f64::INFINITY,
    f64::NEG_INFINITY,
    f64::NEG_INFINITY,
    f64::NEG_INFINITY,
];

/// Grows `into` to hold `other`.
pub(super) fn grow(into: &mut [f64; 6], other: &[f64; 6]) {
    for axis in 0..3 {
        into[axis] = into[axis].min(other[axis]);
        into[axis + 3] = into[axis + 3].max(other[axis + 3]);
    }
}

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
            let mut union = EMPTY;
            for primitive in primitives {
                grow(&mut union, &primitive_box(accessors, primitive)?);
            }
            (!primitives.is_empty()).then_some(union)
        })
        .collect()
}

/// The world box of a local box under `world`: the eight corners transformed, then their union.
pub(super) fn world_box(world: &Mat4, local: &[f64; 6]) -> [f64; 6] {
    let mut out = EMPTY;
    for corner in 0..8 {
        let p = [0, 1, 2].map(|axis| local[axis + 3 * ((corner >> axis) & 1)]);
        let q = [0, 1, 2].map(|axis| {
            world[axis] * p[0] + world[4 + axis] * p[1] + world[8 + axis] * p[2] + world[12 + axis]
        });
        grow(&mut out, &[q[0], q[1], q[2], q[0], q[1], q[2]]);
    }
    out
}
