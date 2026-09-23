//! Lamps of the `blend` driver, proven on an SDNA written here.
//!
//! The repository's CC0 fixture holds no lamp, and the repository does not build `.blend` files:
//! as for the old header layout, the file is therefore written from the public description of
//! the format — an SDNA of a single `Lamp` structure, and a data block typed by it. That is
//! exactly what the driver will read from a real file: the same structure, asked for by the same
//! field names.
use super::*;

/// The fields of the `Lamp` structure this reader asks for, in the order the SDNA describes them.
const FIELDS: [(&str, &str); 12] = [
    ("short", "type"),
    ("float", "r"),
    ("float", "g"),
    ("float", "b"),
    ("float", "energy_new"),
    ("float", "exposure"),
    ("float", "radius"),
    ("float", "spotsize"),
    ("float", "spotblend"),
    ("short", "area_shape"),
    ("float", "area_size"),
    ("float", "area_sizey"),
];
/// World scale of the object that holds the lamp: the emitter radius goes through it.
const SCALE: f64 = 2.0;

/// A Blender file of a single `Lamp` structure, and one data block per given lamp. Each lamp is
/// described by the values of `FIELDS`, in the same order.
fn lamp_file(lamps: &[[f32; 12]]) -> Vec<u8> {
    let mut sdna = Vec::new();
    sdna.extend_from_slice(b"SDNA");
    let names: Vec<Vec<u8>> = FIELDS
        .iter()
        .map(|(_, name)| format!("{name}\0").into_bytes())
        .collect();
    section(&mut sdna, b"NAME", &names);
    let types = [b"short\0".to_vec(), b"float\0".to_vec(), b"Lamp\0".to_vec()];
    section(&mut sdna, b"TYPE", &types);
    sdna.extend_from_slice(b"TLEN");
    for length in [2u16, 4, span() as u16] {
        sdna.extend_from_slice(&length.to_le_bytes());
    }
    sdna.extend_from_slice(&[0, 0]);
    sdna.extend_from_slice(b"STRC");
    sdna.extend_from_slice(&1u32.to_le_bytes());
    sdna.extend_from_slice(&2u16.to_le_bytes());
    sdna.extend_from_slice(&(FIELDS.len() as u16).to_le_bytes());
    for (rank, (kind, _)) in FIELDS.iter().enumerate() {
        let kind = u16::from(*kind == "float");
        sdna.extend_from_slice(&kind.to_le_bytes());
        sdna.extend_from_slice(&(rank as u16).to_le_bytes());
    }
    let mut out = b"BLENDER-v405".to_vec();
    block(&mut out, b"DNA1", 0, 0, &sdna);
    for (rank, values) in lamps.iter().enumerate() {
        block(&mut out, b"DATA", 0, 0x4242 + rank as u64, &packed(values));
    }
    block(&mut out, b"ENDB", 0, 0, &[]);
    out
}

/// The size of a `Lamp`: the sum of its fields, without padding, as the SDNA chains them.
fn span() -> usize {
    FIELDS
        .iter()
        .map(|(kind, _)| if *kind == "float" { 4 } else { 2 })
        .sum()
}

/// The bytes of a lamp: each value written at the width its field declares.
fn packed(values: &[f32; 12]) -> Vec<u8> {
    let mut out = Vec::with_capacity(span());
    for ((kind, _), value) in FIELDS.iter().zip(values) {
        if *kind == "float" {
            out.extend_from_slice(&value.to_le_bytes());
        } else {
            out.extend_from_slice(&(*value as i16).to_le_bytes());
        }
    }
    out
}

/// The lamps this file gives the driver, converted, and what it counted.
fn converted(lamps: &[[f32; 12]], names: &[&str]) -> (Vec<Value>, Out) {
    let bytes = lamp_file(lamps);
    let file = BlendFile::open(&bytes, MAX_BYTES).expect("the file written for this test");
    let mut out = Out::default();
    for (block, name) in file.of(*b"DATA").zip(names) {
        let view = file.view(block).expect("the lamp's view");
        light::build(Some(view), (*name).to_string(), SCALE, &mut out);
    }
    (out.lights.clone(), out)
}

// Behaviour: the four lamp types Blender writes become glTF lights, each field being asked for
// by its name from the SDNA — power, exposure, colour, cone — and the emitter radius coming from
// the native data, carried in world metres by the object's scale.
#[test]
fn the_four_blender_lamp_types_become_gltf_lights_with_their_native_emitter_radius() {
    // type, r, g, b, energy_new, exposure, radius, spotsize, spotblend, area_shape, x, y
    let lamps = [
        [
            0.0, 1.0, 0.5, 0.25, 1000.0, 0.0, 0.25, 0.0, 0.0, 0.0, 0.0, 0.0,
        ],
        [1.0, 1.0, 1.0, 1.0, 3.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        [
            2.0, 1.0, 1.0, 1.0, 100.0, 0.0, 0.125, 1.0, 0.5, 0.0, 0.0, 0.0,
        ],
        [4.0, 1.0, 1.0, 1.0, 50.0, 0.0, 0.0, 0.0, 0.0, 1.0, 3.0, 4.0],
    ];
    let names = ["Ampoule", "Soleil", "Projecteur", "Panneau"];
    let (lights, out) = converted(&lamps, &names);
    // Power in watts is spread over the sphere for a point and a spot, over the lambertian
    // hemisphere for an area, and a sun's strength is already an illuminance; the 683 factor is
    // the candela per watt per steradian. Products are written in the order the conversion stores
    // them, the last decimal of a float depending on that order.
    let sphere = 1.0 / (4.0 * std::f64::consts::PI);
    let disc = 1.0 / std::f64::consts::PI;
    assert_eq!(
        json!(lights),
        json!([
            {"name":"Ampoule","type":"point","color":[1.0,0.5,0.25],
             "intensity":1000.0 * sphere * 683.0,"extras":{"emitterRadius":0.5}},
            {"name":"Soleil","type":"directional","color":[1.0,1.0,1.0],
             "intensity":6.0 * 683.0},
            {"name":"Projecteur","type":"spot","color":[1.0,1.0,1.0],
             "intensity":100.0 * sphere * 683.0,"extras":{"emitterRadius":0.25},
             "spot":{"innerConeAngle":0.25,"outerConeAngle":0.5}},
            {"name":"Panneau","type":"point","color":[1.0,1.0,1.0],
             "intensity":50.0 * disc * 683.0,"extras":{"emitterRadius":5.0}},
        ]),
        "lamps converted from the SDNA have changed"
    );
    assert!(
        out.report.unsupported.is_empty(),
        "nothing was expected to be refused"
    );
}

// Behaviour: a lamp type this driver does not convert — the `hemi` of files from before
// Blender 2.8 — is counted by its name, and does not enter the scene.
#[test]
fn a_lamp_type_this_driver_does_not_convert_is_counted_by_its_name() {
    let hemi = [3.0, 1.0, 1.0, 1.0, 10.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
    let (lights, out) = converted(&[hemi], &["Hemi"]);
    assert!(lights.is_empty(), "no lamp was expected to come out");
    assert_eq!(
        out.report.unsupported.get("blend-light-type-unsupported"),
        Some(&1)
    );
}
