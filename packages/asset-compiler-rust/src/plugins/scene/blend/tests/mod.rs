//! What only the inside of the driver can prove: reading a file in the old header layout, of
//! which the repository holds no specimen, cutting an n-gon on geometry posed by hand, and the
//! defects reproduced by patching the CC0 fixture through the SDNA it itself carries — `surgery`
//! for the patch, `fidelite`, `matiere` and `normales` for what it proves. The golden scene is
//! compared in `src/tests/formats/blend_golden.rs`.
use super::*;
use crate::tests::ngons::{rendered_area, U_RING};

mod bounds;
mod fidelity;
mod lamps;
mod material;
mod output;
mod surgery;
mod transparency;
mod uri;
mod vertex_normals;

/// Writes a minimal Blender file in the old layout, from the format description: a twelve-byte
/// header, thirty-two-bit-field blocks, a `DNA1` of a single structure and a data block typed by
/// it.
fn legacy_file(value: f32) -> Vec<u8> {
    let mut sdna = Vec::new();
    sdna.extend_from_slice(b"SDNA");
    section(
        &mut sdna,
        b"NAME",
        &[b"*next\0".to_vec(), b"value\0".to_vec()],
    );
    section(
        &mut sdna,
        b"TYPE",
        &[b"void\0".to_vec(), b"float\0".to_vec(), b"Thing\0".to_vec()],
    );
    sdna.extend_from_slice(b"TLEN");
    for length in [0u16, 4, 12] {
        sdna.extend_from_slice(&length.to_le_bytes());
    }
    sdna.extend_from_slice(&[0, 0]);
    sdna.extend_from_slice(b"STRC");
    sdna.extend_from_slice(&1u32.to_le_bytes());
    for word in [2u16, 2, 0, 0, 1, 1] {
        sdna.extend_from_slice(&word.to_le_bytes());
    }
    let mut out = b"BLENDER-v405".to_vec();
    block(&mut out, b"DNA1", 0, 0, &sdna);
    let mut data = 0u64.to_le_bytes().to_vec();
    data.extend_from_slice(&value.to_le_bytes());
    block(&mut out, b"DATA", 0, 0x4242, &data);
    block(&mut out, b"ENDB", 0, 0, &[]);
    out
}

/// An SDNA string section: its tag, its count, the strings, alignment on four.
fn section(out: &mut Vec<u8>, label: &[u8; 4], entries: &[Vec<u8>]) {
    out.extend_from_slice(label);
    out.extend_from_slice(&(entries.len() as u32).to_le_bytes());
    for entry in entries {
        out.extend_from_slice(entry);
    }
    while !out.len().is_multiple_of(4) {
        out.push(0);
    }
}

/// A block in the old layout: code, size, original address, SDNA index, count.
fn block(out: &mut Vec<u8>, code: &[u8; 4], sdna: u32, old: u64, data: &[u8]) {
    out.extend_from_slice(code);
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(&old.to_le_bytes());
    out.extend_from_slice(&sdna.to_le_bytes());
    out.extend_from_slice(&1u32.to_le_bytes());
    out.extend_from_slice(data);
}

// Behaviour: the old header layout reads, and a field is asked for by its name — it is the
// file's SDNA, never a hardcoded offset, that says where it starts.
#[test]
fn an_old_header_reads_and_its_fields_resolve_by_name() {
    let bytes = legacy_file(2.5);
    let file = BlendFile::open(&bytes, MAX_BYTES).expect("a file in the old layout");
    assert_eq!(file.version, 405);
    let thing = file.dna.index("Thing").expect("the file's structure");
    let field = file.dna.layout(thing).expect("its layout");
    assert_eq!(field.field("next").expect("next").offset, 0);
    assert_eq!(field.field("value").expect("value").offset, POINTER);
    let block = file.of(*b"DATA").next().expect("the data block");
    let view = file.view(block).expect("its view");
    assert_eq!(view.float("value", 0.0), 2.5);
    assert_eq!(
        view.float("absent", 7.0),
        7.0,
        "an absent field yields the default"
    );
}

// Behaviour: a file whose header announces 32-bit pointers, big-endian or an unknown block
// variant is refused by name, never read askew.
#[test]
fn headers_outside_the_subset_are_refused_by_name() {
    let mut narrow = legacy_file(1.0);
    narrow[7] = b'_';
    assert_eq!(refusal(&narrow), "blend-pointer-size-unsupported");
    let mut reversed = legacy_file(1.0);
    reversed[8] = b'V';
    assert_eq!(refusal(&reversed), "blend-endianness-unsupported");
    assert_eq!(
        refusal(b"not a blender file at all"),
        "blend-header-invalid"
    );
}

fn refusal(bytes: &[u8]) -> &'static str {
    BlendFile::open(bytes, MAX_BYTES)
        .err()
        .expect("this file was expected to be refused")
        .code
}

// Behaviour: a concave polygon keeps exactly the area it carries. Fanning from the first corner
// crossed the U's hollow and yielded eleven for seven; ears yield seven.
#[test]
fn a_concave_polygon_keeps_its_own_area() {
    let geometry = Geometry {
        positions: U_RING
            .iter()
            .flat_map(|[x, y]| [*x as f32, *y as f32, 0.0])
            .collect(),
        corners: (0..8).collect(),
        offsets: vec![0, 8],
        uv: Vec::new(),
        material: vec![0],
        sharp: vec![true],
        sharp_corners: Vec::new(),
    };
    let mut out = Out::default();
    let normals = normals::corners(&geometry.surface()).normals;
    let (mesh, triangles) = build::mesh_json(
        &geometry,
        &normals,
        &[None],
        "U",
        &mut out,
        &std::sync::atomic::AtomicBool::new(false),
    )
    .expect("the mesh");
    assert_eq!(triangles, 6, "eight corners make six triangles");
    assert_eq!(out.counts.get("blend-ngon-untriangulable"), None);
    let primitive = &mesh["primitives"][0];
    let positions: Vec<f32> = read(&out, &primitive["attributes"]["POSITION"])
        .as_chunks::<4>()
        .0
        .iter()
        .map(|word| f32::from_le_bytes(*word))
        .collect();
    let indices: Vec<u32> = read(&out, &primitive["indices"])
        .as_chunks::<4>()
        .0
        .iter()
        .map(|word| u32::from_le_bytes(*word))
        .collect();
    let area = rendered_area(&positions, &indices);
    assert!(
        (area - 7.0).abs() < 1e-5,
        "rendered area {area}, expected 7"
    );
}

/// The bytes of an accessor of the scene under construction, by the binary view it cites.
fn read<'a>(out: &'a Out, accessor: &Value) -> &'a [u8] {
    let rank = accessor.as_u64().expect("accessor") as usize;
    let view = out.accessors[rank]["bufferView"].as_u64().expect("view") as usize;
    let from = out.bin.views[view]["byteOffset"].as_u64().expect("start") as usize;
    let length = out.bin.views[view]["byteLength"].as_u64().expect("length") as usize;
    &out.bin.bytes[from..from + length]
}
