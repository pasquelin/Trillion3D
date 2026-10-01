//! Tessellated face indices stay in source order, with no welding or deduplication.
use super::*;
use crate::shared_math::{cross, sub, unit};
pub(super) fn triangle(
    out: &mut Vertices,
    points: [[f64; 3]; 3],
    normals: Option<[[f64; 3]; 3]>,
) -> Result<()> {
    let normal =
        unit(cross(sub(points[1], points[0]), sub(points[2], points[0]))).unwrap_or([0.; 3]);
    for (corner, point) in points.into_iter().enumerate() {
        out.indices
            .push(u32::try_from(out.count()).map_err(|_| invalid("too many corners"))?);
        for value in point {
            out.positions.push(source::finite(value, "ifc")?);
        }
        for value in normals.map(|n| n[corner]).unwrap_or(normal) {
            out.normals.push(source::finite(value, "ifc")?);
        }
    }
    Ok(())
}
fn index(value: &Value) -> Result<usize> {
    value
        .as_int()
        .and_then(|v| v.checked_sub(1))
        .and_then(|v| usize::try_from(v).ok())
        .ok_or_else(|| invalid("expected positive face index"))
}
pub(super) fn read(all: &Entities, e: &Entity, request: &SceneRequest<'_>) -> Result<Vertices> {
    if e.kind == "IFCEXTRUDEDAREASOLID" {
        return extrusion::read(all, e, request);
    }
    if e.kind != "IFCTRIANGULATEDFACESET" {
        return Err(source::unsupported(
            "ifc",
            format!("representation item {}", e.kind),
        ));
    }
    let d = &e.data;
    let points = entity(all, reference(d, 0)?)?;
    if points.kind != "IFCCARTESIANPOINTLIST3D" {
        return Err(invalid("face set coordinates are not 3D point list"));
    }
    let vertices: Vec<[f64; 3]> = list(&points.data, 0)?
        .iter()
        .map(tuple)
        .collect::<Result<_>>()?;
    let normals = d
        .get_list(1)
        .map(|v| v.iter().map(tuple::<3>).collect::<Result<Vec<_>>>())
        .transpose()?;
    if normals.as_ref().is_some_and(|n| n.len() != vertices.len()) {
        return Err(source::unsupported(
            "ifc",
            "normal count differs from coordinate count",
        ));
    }
    if d.get(4).is_some_and(|v| !matches!(v, Value::Null)) {
        return Err(source::unsupported(
            "ifc",
            "triangulated face set PnIndex remapping",
        ));
    }
    let faces = list(d, 3)?;
    source::admit(
        faces.len().saturating_mul(256),
        request.ram_budget / 4,
        "ifc",
    )?;
    let mut out = Vertices::default();
    for (rank, face) in faces.iter().enumerate() {
        if super::super::cancel::stopped(request.cancelled, rank) {
            return Err(super::super::cancel::refusal());
        }
        let indices = face
            .as_list()
            .ok_or_else(|| invalid("face is not index list"))?;
        if indices.len() != 3 {
            return Err(invalid("triangle needs three indices"));
        }
        let mut p = [[0.; 3]; 3];
        let mut n = p;
        for (corner, value) in indices.iter().enumerate() {
            let index = index(value)?;
            p[corner] = *vertices
                .get(index)
                .ok_or_else(|| invalid("face vertex out of range"))?;
            if let Some(normals) = &normals {
                n[corner] = normals[index];
            }
        }
        triangle(&mut out, p, normals.as_ref().map(|_| n))?;
    }
    Ok(out)
}
