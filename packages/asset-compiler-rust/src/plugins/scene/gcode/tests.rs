use super::super::mesh_source::test_support::{attribute, read};
use super::*;

#[test]
fn gcode_modal_units_offsets_and_extrusion_keep_distinct_paths() {
    let scene = read(
        &GCODE,
        b"G21\nG90\nG0X10Y20Z30\nG1X20E1F600\nG92X0E0\nG91\nM83\nG1X5E2\nG20\nG1X1\n",
        1 << 20,
    )
    .unwrap();
    assert_eq!(scene.mesh_triangles, [0]);
    let parts = scene.meshes[0]["primitives"].as_array().unwrap();
    assert_eq!(parts.len(), 3);
    assert!(parts.iter().all(|part| part["mode"] == 1));
    let rapid = attribute(&scene, &parts[0], "POSITION");
    assert_eq!(rapid, [0.0, 0.0, -0.0, 0.01, 0.03, -0.02]);
    let extrusion = attribute(&scene, &parts[2], "POSITION");
    assert_eq!(extrusion.len(), 12);
    assert!((extrusion[9] - 0.025).abs() < 1e-7);
    let moves = scene.meshes[0]["extras"]["moves"].as_array().unwrap();
    assert_eq!(moves.len(), 4);
    assert!((moves[1]["feedMetresPerSecond"].as_f64().unwrap() - 0.01).abs() < 1e-9);
}

#[test]
fn gcode_refuses_unsupported_motion_malformed_words_and_budget_overflow() {
    for text in [
        "G2X1",
        "G28",
        "G1XNaN",
        "G1X1X2",
        "G1X1(comment",
        "G1X1*23",
        "G1A2",
    ] {
        assert!(read(&GCODE, text.as_bytes(), 1 << 20).is_err(), "{text}");
    }
    assert!(read(&GCODE, b"G1X1", 1024).is_err());
}
#[test]
fn process_parameters_cannot_become_motion_or_invalid_feed_values() {
    for text in [
        "G1X1S200",
        "M104S200X10",
        "M82E1",
        "G1X1F-600",
        "G1X1F0",
        "N1.5G1X1",
    ] {
        assert!(read(&GCODE, text.as_bytes(), 1 << 20).is_err(), "{text}");
    }
    let scene = read(&GCODE, b"G1X1\nM104S200\nG1X2", 1 << 20).unwrap();
    let moves = scene.meshes[0]["extras"]["moves"].as_array().unwrap();
    assert_eq!(moves.len(), 2);
    assert_eq!(
        attribute(&scene, &scene.meshes[0]["primitives"][0], "POSITION"),
        [0., 0., -0., 0.001, 0., -0., 0.001, 0., -0., 0.002, 0., -0.]
    );
}
