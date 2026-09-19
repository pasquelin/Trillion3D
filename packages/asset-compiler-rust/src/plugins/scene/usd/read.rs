//! Reading a composed attribute, and converting its value toward what the intermediate scene
//! can carry.
//!
//! USD types its attributes finely — `point3f[]`, `point3d[]`, `normal3h[]` describe the same
//! thing to a precision — and a real scene mixes the three. Each function here therefore
//! accepts every writing of the same quantity and yields the unique form glTF asks. What does
//! not fold into it yields `None`: the caller counts it by name, it does not guess.
use openusd::{sdf, usd};

/// Default value of an attribute, or its first time sample when it has none. The second member
/// says which of the two answered: a scene read at its first sample is frozen, and the caller
/// publishes it in the report.
pub(super) fn first(attribute: &usd::Attribute) -> Option<(sdf::Value, bool)> {
    if let Ok(Some(value)) = attribute.get::<sdf::Value>() {
        return Some((value, false));
    }
    let samples = attribute.time_samples().ok().flatten()?;
    samples
        .iter()
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, value)| (value.clone(), true))
}

/// A number: float, double, half or integer.
pub(super) fn number(value: &sdf::Value) -> Option<f64> {
    Some(match value {
        sdf::Value::Float(v) => f64::from(*v),
        sdf::Value::Double(v) => *v,
        sdf::Value::Half(v) => f64::from(f32::from(*v)),
        sdf::Value::Int(v) => f64::from(*v),
        _ => return None,
    })
}

/// A triple: a colour, a normal, a position or the three angles of a rotation.
pub(super) fn triple(value: &sdf::Value) -> Option<[f64; 3]> {
    Some(match value {
        sdf::Value::Vec3f(v) => [f64::from(v.x), f64::from(v.y), f64::from(v.z)],
        sdf::Value::Vec3d(v) => [v.x, v.y, v.z],
        sdf::Value::Vec3h(v) => [
            f64::from(f32::from(v.x)),
            f64::from(f32::from(v.y)),
            f64::from(f32::from(v.z)),
        ],
        _ => return None,
    })
}

/// Components of a scalar or vector value, whatever its width: a texture's `scale` and `bias`
/// are written as `float4`, but a layer sometimes writes them shorter.
pub(super) fn components(value: &sdf::Value) -> Option<Vec<f64>> {
    if let Some(one) = number(value) {
        return Some(vec![one]);
    }
    if let Some(three) = triple(value) {
        return Some(three.to_vec());
    }
    Some(match value {
        sdf::Value::Vec4f(v) => vec![
            f64::from(v.x),
            f64::from(v.y),
            f64::from(v.z),
            f64::from(v.w),
        ],
        sdf::Value::Vec4d(v) => vec![v.x, v.y, v.z, v.w],
        sdf::Value::Vec2f(v) => vec![f64::from(v.x), f64::from(v.y)],
        sdf::Value::Vec2d(v) => vec![v.x, v.y],
        _ => return None,
    })
}

/// An array of triples: points, normals or per-vertex colours.
pub(super) fn triples(value: &sdf::Value) -> Option<Vec<[f32; 3]>> {
    Some(match value {
        sdf::Value::Vec3fVec(v) => v.iter().map(|p| [p.x, p.y, p.z]).collect(),
        sdf::Value::Vec3dVec(v) => v
            .iter()
            .map(|p| [p.x as f32, p.y as f32, p.z as f32])
            .collect(),
        sdf::Value::Vec3hVec(v) => v
            .iter()
            .map(|p| [f32::from(p.x), f32::from(p.y), f32::from(p.z)])
            .collect(),
        _ => return None,
    })
}

/// An array of pairs: texture coordinates.
pub(super) fn pairs(value: &sdf::Value) -> Option<Vec<[f32; 2]>> {
    Some(match value {
        sdf::Value::Vec2fVec(v) => v.iter().map(|p| [p.x, p.y]).collect(),
        sdf::Value::Vec2dVec(v) => v.iter().map(|p| [p.x as f32, p.y as f32]).collect(),
        sdf::Value::Vec2hVec(v) => v.iter().map(|p| [f32::from(p.x), f32::from(p.y)]).collect(),
        _ => return None,
    })
}

/// An array of integers: vertex counts per face, indices, faces of a `GeomSubset`. A negative
/// integer or one outside the domain of a `usize` becomes `None` in use, never a panic.
pub(super) fn integers(value: &sdf::Value) -> Option<Vec<i64>> {
    Some(match value {
        sdf::Value::IntVec(v) => v.iter().map(|i| i64::from(*i)).collect(),
        sdf::Value::UintVec(v) => v.iter().map(|i| i64::from(*i)).collect(),
        sdf::Value::Int64Vec(v) => v.clone(),
        sdf::Value::Uint64Vec(v) => v.iter().map(|i| *i as i64).collect(),
        _ => return None,
    })
}

/// Text: a token or a string, which USD uses one for the other depending on the schemas.
pub(super) fn text(value: &sdf::Value) -> Option<String> {
    Some(match value {
        sdf::Value::Token(v) => v.as_str().to_string(),
        sdf::Value::String(v) => v.clone(),
        _ => return None,
    })
}

/// A boolean.
pub(super) fn flag(value: &sdf::Value) -> Option<bool> {
    match value {
        sdf::Value::Bool(v) => Some(*v),
        _ => None,
    }
}

/// Asset path of a value, as composition yielded it: the path written in the layer, and the one
/// it resolved against that layer's directory when the file is there.
pub(super) fn asset(value: &sdf::Value) -> Option<&sdf::AssetPath> {
    match value {
        sdf::Value::AssetPath(path) => Some(path),
        _ => None,
    }
}

/// Sixteen numbers of a `matrix4d`, already in glTF order.
pub(super) fn matrix(value: &sdf::Value) -> Option<[f64; 16]> {
    match value {
        sdf::Value::Matrix4d(m) => Some(m.0),
        _ => None,
    }
}

/// A quaternion `(w, x, y, z)`.
pub(super) fn quaternion(value: &sdf::Value) -> Option<[f64; 4]> {
    Some(match value {
        sdf::Value::Quatf(q) => [
            f64::from(q.w),
            f64::from(q.x),
            f64::from(q.y),
            f64::from(q.z),
        ],
        sdf::Value::Quatd(q) => [q.w, q.x, q.y, q.z],
        sdf::Value::Quath(q) => [
            f64::from(f32::from(q.w)),
            f64::from(f32::from(q.x)),
            f64::from(f32::from(q.y)),
            f64::from(f32::from(q.z)),
        ],
        _ => return None,
    })
}

/// An attribute metadata read as text — a primvar's `interpolation`, among others.
pub(super) fn metadata(attribute: &usd::Attribute, key: &str) -> Option<String> {
    attribute
        .get_metadata::<sdf::Value>(key)
        .ok()
        .flatten()
        .as_ref()
        .and_then(text)
}
