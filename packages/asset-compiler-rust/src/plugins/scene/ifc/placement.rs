//! Finite right-handed IFC axis placements and cycle-bounded parent chains.
use super::*;
use crate::compiler_world::{multiply, Mat4, IDENTITY};
use crate::shared_math::{cross, unit};
fn coordinates(all: &Entities, id: u32, kind: &str) -> Result<Vec<f64>> {
    let e = entity(all, id)?;
    if e.kind != kind {
        return Err(invalid(format!("expected {kind}")));
    }
    list(&e.data, 0)?.iter().map(number).collect()
}
pub(super) fn direction(all: &Entities, id: u32) -> Result<[f64; 3]> {
    let values = coordinates(all, id, "IFCDIRECTION")?;
    let values: [f64; 3] = values
        .try_into()
        .map_err(|_| invalid("direction must have three coordinates"))?;
    unit(values).ok_or_else(|| invalid("zero direction"))
}
pub(super) fn axis(all: &Entities, id: u32) -> Result<Mat4> {
    let e = entity(all, id)?;
    let d = &e.data;
    let position = coordinates(all, reference(d, 0)?, "IFCCARTESIANPOINT")?;
    let (origin, x, z) = match e.kind.as_str() {
        "IFCAXIS2PLACEMENT3D" => {
            let origin: [f64; 3] = position
                .try_into()
                .map_err(|_| invalid("3D origin dimension"))?;
            let z = d
                .get_ref(1)
                .map(|id| direction(all, id))
                .transpose()?
                .unwrap_or([0., 0., 1.]);
            let x = d
                .get_ref(2)
                .map(|id| direction(all, id))
                .transpose()?
                .unwrap_or([1., 0., 0.]);
            (origin, x, z)
        }
        "IFCAXIS2PLACEMENT2D" => {
            let p: [f64; 2] = position
                .try_into()
                .map_err(|_| invalid("2D origin dimension"))?;
            let x = if let Some(id) = d.get_ref(1) {
                let v = coordinates(all, id, "IFCDIRECTION")?;
                let v: [f64; 2] = v
                    .try_into()
                    .map_err(|_| invalid("2D direction dimension"))?;
                [v[0], v[1], 0.]
            } else {
                [1., 0., 0.]
            };
            ([p[0], p[1], 0.], x, [0., 0., 1.])
        }
        _ => return Err(source::unsupported("ifc", format!("placement {}", e.kind))),
    };
    let y = unit(cross(z, x)).ok_or_else(|| invalid("parallel placement axes"))?;
    let x = cross(y, z);
    Ok([
        x[0], x[1], x[2], 0., y[0], y[1], y[2], 0., z[0], z[1], z[2], 0., origin[0], origin[1],
        origin[2], 1.,
    ])
}
pub(super) fn local(all: &Entities, id: Option<u32>) -> Result<Mat4> {
    let mut stack = Vec::new();
    let mut seen = BTreeSet::new();
    let mut current = id;
    while let Some(id) = current {
        if seen.len() >= 256 || !seen.insert(id) {
            return Err(invalid("placement cycle/depth"));
        }
        let e = entity(all, id)?;
        if e.kind != "IFCLOCALPLACEMENT" {
            return Err(source::unsupported("ifc", &e.kind));
        }
        stack.push(axis(all, reference(&e.data, 1)?)?);
        current = e.data.get_ref(0);
    }
    let mut result = IDENTITY;
    for matrix in stack.into_iter().rev() {
        result = multiply(&result, &matrix);
    }
    Ok(result)
}
pub(super) fn units(all: &Entities) -> Result<f64> {
    let projects: Vec<_> = all.values().filter(|e| e.kind == "IFCPROJECT").collect();
    let [project] = projects.as_slice() else {
        return Err(invalid("expected one IfcProject"));
    };
    let assignment = entity(all, reference(&project.data, 8)?)?;
    if assignment.kind != "IFCUNITASSIGNMENT" {
        return Err(invalid("project has no unit assignment"));
    }
    let mut scale = None;
    for value in list(&assignment.data, 0)? {
        let unit = entity(
            all,
            value
                .as_entity_ref()
                .ok_or_else(|| invalid("unit is not reference"))?,
        )?;
        if unit.data.get(1).and_then(Value::as_enum) != Some("LENGTHUNIT") {
            continue;
        }
        if unit.kind != "IFCSIUNIT" || unit.data.get(3).and_then(Value::as_enum) != Some("METRE") {
            return Err(source::unsupported("ifc", "non-SI length unit"));
        }
        let value = match unit.data.get(2).and_then(Value::as_enum) {
            None => 1.,
            Some("MILLI") => 0.001,
            Some("CENTI") => 0.01,
            Some("DECI") => 0.1,
            Some("KILO") => 1000.,
            Some("MICRO") => 1e-6,
            Some(v) => return Err(source::unsupported("ifc", format!("length prefix {v}"))),
        };
        if scale.replace(value).is_some() {
            return Err(invalid("multiple length units"));
        }
    }
    scale.ok_or_else(|| invalid("missing length unit"))
}
