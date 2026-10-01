//! Controlled straight extrusions of rectangle and closed polyline profiles, without fallback.
use super::*;
use crate::compiler_world::{transform_point, IDENTITY};
fn profile(all: &Entities, id: u32) -> Result<Vec<[f64; 3]>> {
    let e = entity(all, id)?;
    let d = &e.data;
    if d.get(0).and_then(Value::as_enum) != Some("AREA") {
        return Err(source::unsupported("ifc", "non-area profile"));
    }
    match e.kind.as_str() {
        "IFCRECTANGLEPROFILEDEF" => {
            let x = d
                .get_float(3)
                .filter(|v| v.is_finite() && *v > 0.)
                .ok_or_else(|| invalid("invalid rectangle width"))?
                / 2.;
            let y = d
                .get_float(4)
                .filter(|v| v.is_finite() && *v > 0.)
                .ok_or_else(|| invalid("invalid rectangle height"))?
                / 2.;
            let matrix = d
                .get_ref(2)
                .map(|id| placement::axis(all, id))
                .transpose()?
                .unwrap_or(IDENTITY);
            Ok([[-x, -y, 0.], [x, -y, 0.], [x, y, 0.], [-x, y, 0.]]
                .map(|p| transform_point(&matrix, p))
                .to_vec())
        }
        "IFCARBITRARYCLOSEDPROFILEDEF" => {
            let curve = entity(all, reference(d, 2)?)?;
            if curve.kind != "IFCPOLYLINE" {
                return Err(source::unsupported("ifc", "non-polyline profile"));
            }
            let mut points = Vec::new();
            for value in list(&curve.data, 0)? {
                let point = entity(
                    all,
                    value
                        .as_entity_ref()
                        .ok_or_else(|| invalid("profile point is not reference"))?,
                )?;
                if point.kind != "IFCCARTESIANPOINT" {
                    return Err(invalid("profile point type"));
                }
                let values = list(&point.data, 0)?;
                if values.len() != 2 {
                    return Err(source::unsupported("ifc", "non-planar profile"));
                }
                points.push([number(&values[0])?, number(&values[1])?, 0.]);
            }
            if points.first() != points.last() {
                return Err(invalid("profile polyline is not closed"));
            }
            points.pop();
            Ok(points)
        }
        _ => Err(source::unsupported("ifc", format!("profile {}", e.kind))),
    }
}
pub(super) fn read(all: &Entities, e: &Entity, request: &SceneRequest<'_>) -> Result<Vertices> {
    let d = &e.data;
    let mut ring = profile(all, reference(d, 0)?)?;
    if !(3..=4096).contains(&ring.len()) {
        return Err(source::unsupported("ifc", "profile needs 3..4096 corners"));
    }
    let area: f64 = (0..ring.len())
        .map(|i| {
            let a = ring[i];
            let b = ring[(i + 1) % ring.len()];
            a[0] * b[1] - b[0] * a[1]
        })
        .sum();
    if area < 0. {
        ring.reverse();
    }
    let direction = placement::direction(all, reference(d, 2)?)?;
    if direction[2].abs() < 1e-12 {
        return Err(invalid("extrusion direction lies in profile plane"));
    }
    let depth = d
        .get_float(3)
        .filter(|v| v.is_finite() && *v > 0.)
        .ok_or_else(|| invalid("invalid extrusion depth"))?;
    let matrix = d
        .get_ref(1)
        .map(|id| placement::axis(all, id))
        .transpose()?
        .unwrap_or(IDENTITY);
    let mut cutter = super::super::ngon::Ngon::default();
    cutter.begin();
    for p in &ring {
        cutter.corner(*p);
    }
    match cutter.cut(request.cancelled) {
        None => return Err(super::super::cancel::refusal()),
        Some(false) => return Err(invalid("profile has no valid triangulation")),
        Some(true) => {}
    }
    source::admit(
        ring.len().saturating_mul(1024),
        request.ram_budget / 4,
        "ifc",
    )?;
    let upper: Vec<_> = ring
        .iter()
        .map(|p| {
            [
                p[0] + direction[0] * depth,
                p[1] + direction[1] * depth,
                p[2] + direction[2] * depth,
            ]
        })
        .collect();
    let mut triangles = Vec::new();
    for t in cutter.triangles() {
        triangles.push([ring[t[2]], ring[t[1]], ring[t[0]]]);
        triangles.push([upper[t[0]], upper[t[1]], upper[t[2]]]);
    }
    for i in 0..ring.len() {
        let j = (i + 1) % ring.len();
        triangles.push([ring[i], ring[j], upper[j]]);
        triangles.push([ring[i], upper[j], upper[i]]);
    }
    let mut out = Vertices::default();
    for mut triangle in triangles {
        if direction[2] < 0. {
            triangle.swap(1, 2);
        }
        surface::triangle(
            &mut out,
            triangle.map(|p| transform_point(&matrix, p)),
            None,
        )?;
    }
    Ok(out)
}
