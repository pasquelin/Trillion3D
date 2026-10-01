//! KML geodetic positions become a local WGS84 east/north/up frame; no terrain is invented.
use super::super::mesh_source::xml;
use super::*;
use crate::compiler_world::{axis_angle, multiply, scaling, translation, Mat4};
use roxmltree::Node;
fn component(node: Node<'_, '_>, name: &str, default: f64) -> Result<f64> {
    let Some(child) = xml::child(node, name) else {
        return Ok(default);
    };
    child
        .text()
        .unwrap_or("")
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite())
        .ok_or_else(|| source::invalid("kmz", format!("invalid {name}")))
}
pub(super) fn location(model: Node<'_, '_>) -> Result<[f64; 3]> {
    let mode = xml::child(model, "altitudeMode")
        .and_then(|n| n.text())
        .unwrap_or("clampToGround")
        .trim();
    if mode != "absolute" {
        return Err(source::unsupported(
            "kmz",
            format!("terrain-dependent altitudeMode {mode}"),
        ));
    }
    let loc = xml::required(model, "Location", "kmz")?;
    let p = [
        component(loc, "longitude", 0.)?,
        component(loc, "latitude", 0.)?,
        component(loc, "altitude", 0.)?,
    ];
    if !(-180.0..=180.0).contains(&p[0]) || !(-90.0..=90.0).contains(&p[1]) {
        return Err(source::invalid("kmz", "location outside geodetic range"));
    }
    Ok(p)
}
fn ecef([lon, lat, height]: [f64; 3]) -> [f64; 3] {
    let (lon, lat) = (lon.to_radians(), lat.to_radians());
    let e2 = 6.6943799901413165e-3;
    let n = 6378137. / (1. - e2 * lat.sin().powi(2)).sqrt();
    [
        (n + height) * lat.cos() * lon.cos(),
        (n + height) * lat.cos() * lon.sin(),
        (n * (1. - e2) + height) * lat.sin(),
    ]
}
pub(super) fn matrix(model: Node<'_, '_>, position: [f64; 3], origin: [f64; 3]) -> Result<Mat4> {
    let p = ecef(position);
    let o = ecef(origin);
    let d = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    let (lon, lat) = (origin[0].to_radians(), origin[1].to_radians());
    let enu = [
        -lon.sin() * d[0] + lon.cos() * d[1],
        -lat.sin() * lon.cos() * d[0] - lat.sin() * lon.sin() * d[1] + lat.cos() * d[2],
        lat.cos() * lon.cos() * d[0] + lat.cos() * lon.sin() * d[1] + lat.sin() * d[2],
    ];
    let z_to_y = axis_angle([1., 0., 0.], -std::f64::consts::FRAC_PI_2);
    let mut matrix = multiply(&z_to_y, &translation(enu));
    if let Some(orientation) = xml::child(model, "Orientation") {
        for (name, axis) in [
            ("heading", [0., 0., 1.]),
            ("tilt", [1., 0., 0.]),
            ("roll", [0., 1., 0.]),
        ] {
            matrix = multiply(
                &matrix,
                &axis_angle(axis, -component(orientation, name, 0.)?.to_radians()),
            );
        }
    }
    if let Some(scale) = xml::child(model, "Scale") {
        matrix = multiply(
            &matrix,
            &scaling([
                component(scale, "x", 1.)?,
                component(scale, "y", 1.)?,
                component(scale, "z", 1.)?,
            ]),
        );
    }
    Ok(multiply(
        &matrix,
        &axis_angle([1., 0., 0.], std::f64::consts::FRAC_PI_2),
    ))
}
