use super::format::{encode, file_name, HEADER_BYTES, MAGIC, VERSION};
use super::ies::parse;
use super::{linked_profiles, Photometry, Profiles, DEFAULT_BRIGHTNESS, SIDE};
use half::f16;
use serde_json::json;
use std::collections::BTreeMap;

/// A one-plane profile: three vertical angles, one horizontal, candela 100, 50, 0 times the file's
/// multiplier 2.
const SMALL: &str = "IESNA:LM-63-2002\n[TEST] sample\nTILT=NONE\n1 1000 2 3 1 1 2 0 0 0 1 1 100\n0 90 180\n0\n100 50 0\nEND\n";

fn texel(texture: &[u16], row: usize, column: usize) -> f32 {
    f16::from_bits(texture[row * SIDE + column]).to_f32()
}

// Behaviour: the grid, the greatest candela and the brightness of a small file are what it says.
#[test]
fn a_small_file_reads_its_grid_and_its_greatest_candela() {
    let photometry = parse(SMALL.as_bytes()).unwrap();
    assert_eq!(photometry.v_angles, [0.0, 90.0, 180.0]);
    assert_eq!(photometry.h_angles, [0.0]);
    assert_eq!(photometry.candela, [200.0, 100.0, 0.0]);
    assert_eq!(photometry.max_candela, 200.0);
    assert_eq!(photometry.brightness(), 200.0);
}

// Behaviour: the texture is the candela over the greatest, interpolated between the vertical angles
// (column x is x / 256 of 180 degrees), the same in every row of a one-plane profile.
#[test]
fn the_texture_is_the_candela_over_the_greatest() {
    let texture = parse(SMALL.as_bytes()).unwrap().texture();
    assert_eq!(texture.len(), SIDE * SIDE);
    for row in [0, 17, 255] {
        assert_eq!(texel(&texture, row, 0), 1.0);
        assert_eq!(texel(&texture, row, 64), 0.75);
        assert_eq!(texel(&texture, row, 128), 0.5);
        assert!((texel(&texture, row, 255) - 0.00390625).abs() < 1e-5);
    }
}

// Behaviour: the edition line is optional, a CRLF file reads as an LF one, and the END line is
// optional.
#[test]
fn the_edition_line_the_line_ends_and_the_end_line_do_not_change_the_grid() {
    let plain = parse(SMALL.as_bytes()).unwrap();
    let without_edition = SMALL.replace("IESNA:LM-63-2002\n", "");
    let crlf = SMALL.replace('\n', "\r\n");
    let without_end = SMALL.replace("END\n", "");
    let older = SMALL.replace("IESNA:LM-63-2002", "iesna:lm-63-1995");
    for text in [without_edition, crlf, without_end, older] {
        let read = parse(text.as_bytes()).unwrap();
        assert_eq!(read.candela, plain.candela);
        assert_eq!(read.v_angles, plain.v_angles);
    }
}

// Behaviour: a file the reader does not understand is refused, whole.
#[test]
fn a_file_with_another_tilt_unordered_angles_or_trailing_text_is_refused() {
    for text in [
        SMALL.replace("TILT=NONE", "TILT=INCLUDE"),
        SMALL.replace("0 90 180", "0 180 90"),
        SMALL.replace("END\n", "END\nmore\n"),
        SMALL.replace("1 1000 2", "0 1000 2"),
        SMALL.replace("1 1000 2", "1 1000 -2"),
        SMALL.replace("TILT=NONE\n", ""),
        String::new(),
    ] {
        assert!(parse(text.as_bytes()).is_err(), "{text}");
    }
}

// Behaviour: a count the file cannot hold is refused before it is allocated.
#[test]
fn an_angle_count_larger_than_the_file_is_refused() {
    let text = SMALL.replace("3 1 1 2", "2000000000 2000000000 1 2");
    assert!(parse(text.as_bytes()).is_err());
}

// Behaviour: a file whose greatest candela is not above 0 has the default brightness, and a texture
// of values that are not numbers (the atlas turns them to 0).
#[test]
fn a_file_without_light_has_the_default_brightness() {
    let text = SMALL.replace("100 50 0", "0 0 0");
    let photometry = parse(text.as_bytes()).unwrap();
    assert_eq!(photometry.max_candela, 0.0);
    assert_eq!(photometry.brightness(), DEFAULT_BRIGHTNESS);
    assert!(f16::from_bits(photometry.texture()[0]).is_nan());
}

/// Two horizontal angles, 0 and 90 (a quadrant), two vertical, 0 and 90.
fn quadrant() -> Photometry {
    let text = "TILT=NONE\n1 1000 1 2 2 1 2 0 0 0 1 1 100\n0 90\n0 90\n10 20 30 40\n";
    parse(text.as_bytes()).unwrap()
}

// Behaviour: a file that stops at 90 degrees mirrors in the odd quadrants and repeats in the even.
#[test]
fn horizontal_angles_past_the_last_fold_back_into_the_grid() {
    let p = quadrant();
    let inside = 10.0 + (30.0 - 10.0) * (80.0f32 / 90.0);
    assert!((p.candela_toward(80.0, 0.0) - inside).abs() < 1e-4);
    // 100 degrees is in the second quadrant: mirrored, 90 - 10 = 80.
    assert!((p.candela_toward(100.0, 0.0) - inside).abs() < 1e-4);
    // 190 degrees is in the third: repeated, 190 mod 90 = 10.
    let repeated = 10.0 + (30.0 - 10.0) * (10.0f32 / 90.0);
    assert!((p.candela_toward(190.0, 0.0) - repeated).abs() < 1e-4);
}

// Behaviour: the file has its five words, its magic and its texels; its name follows its bytes.
#[test]
fn the_product_has_its_header_and_its_texels() {
    let photometry = parse(SMALL.as_bytes()).unwrap();
    let bytes = encode(&photometry);
    assert_eq!(bytes.len(), HEADER_BYTES + 2 * SIDE * SIDE);
    assert_eq!(&bytes[..4], b"T3IE");
    let word = |i: usize| u32::from_le_bytes(bytes[4 * i..4 * i + 4].try_into().unwrap());
    assert_eq!(word(0), MAGIC);
    assert_eq!(word(1), VERSION);
    assert_eq!((word(2), word(3)), (SIDE as u32, SIDE as u32));
    assert_eq!(f32::from_bits(word(4)), 200.0);
    assert_eq!(
        u16::from_le_bytes([bytes[HEADER_BYTES], bytes[HEADER_BYTES + 1]]),
        f16::from_f32(1.0).to_bits()
    );
    let name = file_name(&bytes);
    assert!(name.starts_with("light-profile-") && name.ends_with(".bin"));
    assert_eq!(name, file_name(&bytes));
}

// Behaviour: a light that names a file gets the product's name, its direction and its axis; two lights that name
// the same file share one product; a missing file is counted and leaves the light as it was.
#[test]
fn a_light_names_its_profile_and_shares_it() {
    let root = crate::tests::directories::scratch("light-profile", "attach");
    let out = crate::tests::directories::scratch("light-profile", "out");
    std::fs::write(root.join("lamp.ies"), SMALL).unwrap();
    let mut profiles = Profiles::new(&root, &out);
    let mut counts = BTreeMap::new();
    // A node looking down its -Z axis with its +Y axis along the world's -Z.
    let m = [
        1.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0,
    ];
    let named = json!({"extras":{"iesProfile":"lamp.ies","useIesBrightness":true,"iesBrightnessScale":2.0}});
    let mut first = json!({"kind":"point"});
    let mut second = json!({"kind":"spot"});
    profiles.attach(&mut first, &named, &m, &mut counts).unwrap();
    profiles.attach(&mut second, &named, &m, &mut counts).unwrap();
    assert_eq!(first["iesProfile"], second["iesProfile"]);
    assert_eq!(first["direction"], json!([0.0, -1.0, 0.0]));
    assert_eq!(first["emitterAxis"], json!([0.0, 0.0, -1.0]));
    assert_eq!(first["useIesBrightness"], json!(true));
    assert_eq!(first["iesBrightnessScale"], json!(2.0));
    let mut missing = json!({"kind":"point"});
    let absent = json!({"extras":{"iesProfile":"none.ies"}});
    profiles.attach(&mut missing, &absent, &m, &mut counts).unwrap();
    assert!(missing.get("iesProfile").is_none());
    assert_eq!(counts["light-profile-unreadable"], 1);
    let mut sun = json!({"kind":"directional"});
    profiles.attach(&mut sun, &named, &m, &mut counts).unwrap();
    assert!(sun.get("iesProfile").is_none());
    assert_eq!(profiles.into_products().len(), 1);
}

// Behaviour: the cache key learns of the profile files the lights name.
#[test]
fn the_files_the_lights_name_are_listed_with_their_fingerprints() {
    let root = crate::tests::directories::scratch("light-profile", "identity");
    std::fs::write(root.join("a.ies"), SMALL).unwrap();
    let g = json!({"extensions":{"KHR_lights_punctual":{"lights":[
        {"extras":{"iesProfile":"a.ies"}}, {"type":"point"}, {"extras":{"iesProfile":"b.ies"}}
    ]}}});
    let listed = linked_profiles(&g, &root);
    assert_eq!(listed.len(), 2);
    assert!(listed[0]["sha256"].is_string());
    assert!(listed[1]["sha256"].is_null());
    assert!(linked_profiles(&json!({}), &root).is_empty());
}
