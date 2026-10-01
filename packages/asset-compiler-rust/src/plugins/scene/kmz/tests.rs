use super::*;
use crate::compiler_world::transform_point;
fn model(location: &str, orientation: &str) -> String {
    format!("<Model xmlns=\"http://www.opengis.net/kml/2.2\"><altitudeMode>absolute</altitudeMode><Location>{location}</Location>{orientation}</Model>")
}
#[test]
fn wgs84_origin_heading_and_altitude_are_observable_placements() {
    let text = model(
        "<longitude>0</longitude><latitude>0</latitude><altitude>10</altitude>",
        "<Orientation><heading>90</heading></Orientation><Scale><x>2</x><y>2</y><z>2</z></Scale>",
    );
    let document = roxmltree::Document::parse(&text).unwrap();
    let node = document.root_element();
    let p = placement::location(node).unwrap();
    let m = placement::matrix(node, p, [0., 0., 0.]).unwrap();
    let origin = transform_point(&m, [0.; 3]);
    for (actual, expected) in origin.into_iter().zip([0., 10., 0.]) {
        assert!((actual - expected).abs() < 1e-8);
    }
    let east = transform_point(&m, [1., 0., 0.]);
    for (actual, expected) in east.into_iter().zip([0., 10., 2.]) {
        assert!((actual - expected).abs() < 1e-8);
    }
}
#[test]
fn missing_terrain_and_invalid_geodetic_coordinates_are_refused() {
    for text in [
        "<Model/>".to_string(),
        model("<latitude>91</latitude>", ""),
        model("<longitude>NaN</longitude>", ""),
    ] {
        let document = roxmltree::Document::parse(&text).unwrap();
        assert!(placement::location(document.root_element()).is_err());
    }
}
