//! The reader's bounds, proven on minimal files written here from the public description of the
//! format: an SDNA that announces more than the file carries, a view that does not leave its
//! block's bytes, and the size ceiling, which holds whatever the wrapping.
use super::*;

/// An SDNA in the old layout, each part of which can be laid askew: the field names — all of
/// type `float` —, and the number of structures the `STRC` section announces.
fn sdna(names: &[&str], announced: u32) -> Vec<u8> {
    let zero = |list: &[&str]| -> Vec<Vec<u8>> {
        list.iter()
            .map(|text| format!("{text}\0").into_bytes())
            .collect()
    };
    let mut out = b"SDNA".to_vec();
    section(&mut out, b"NAME", &zero(names));
    section(&mut out, b"TYPE", &zero(&["void", "float", "Thing"]));
    out.extend_from_slice(b"TLEN");
    for length in [0u16, 4, 12] {
        out.extend_from_slice(&length.to_le_bytes());
    }
    out.extend_from_slice(&[0, 0]);
    out.extend_from_slice(b"STRC");
    out.extend_from_slice(&announced.to_le_bytes());
    // The structure: its `Thing` type, its field count, then each field by its type and its name.
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&(names.len() as u16).to_le_bytes());
    for rank in 0..names.len() {
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&(rank as u16).to_le_bytes());
    }
    out
}

/// A file in the old layout carrying this SDNA and a data block of `held` bytes.
fn file(sdna: &[u8], held: usize) -> Vec<u8> {
    let mut out = b"BLENDER-v405".to_vec();
    block(&mut out, b"DNA1", 0, 0, sdna);
    block(&mut out, b"DATA", 0, 0x4242, &vec![0u8; held]);
    block(&mut out, b"ENDB", 0, 0, &[]);
    out
}

// Finding 24: an SDNA that announces dimensions, a field size or a structure count the file does
// not carry is refused under its name. Products were stored unbounded: they overflowed — panic
// in debug —, and the `STRC` count reserved before being trusted.
#[test]
fn a_hostile_sdna_is_refused_by_name_never_by_panic() {
    for (case, bytes) in [
        (
            "dimensions whose product overflows",
            file(&sdna(&["value[18446744073709551615][2]"], 1), 16),
        ),
        (
            "a field larger than memory",
            file(&sdna(&["value[4611686018427387904]"], 1), 16),
        ),
        (
            "more structures than the block carries",
            file(&sdna(&["value"], u32::MAX), 16),
        ),
    ] {
        assert_eq!(refusal(&bytes), "blend-dna-invalid", "{case}");
    }
}

// Finding 24: a view reads the fields of its block, and nothing else. A block shorter than the
// structure its header names yielded the next block's bytes as if they were its own.
#[test]
fn a_view_never_reads_past_the_end_of_its_block() {
    let bytes = file(&sdna(&["value"], 1), 0);
    let read = BlendFile::open(&bytes, MAX_BYTES).expect("a minimal file");
    let block = read.of(*b"DATA").next().expect("the data block");
    let view = read.view(block).expect("its view");
    assert_eq!(
        view.float("value", 7.0),
        7.0,
        "a field outside the block yields the default, never the next block's bytes"
    );
}

/// The refusal code of these bytes read under this ceiling.
fn under(bytes: &[u8], ceiling: usize) -> &'static str {
    BlendFile::open(bytes, ceiling)
        .err()
        .expect("this file was expected to be refused")
        .code
}

// Finding 25: the size ceiling applies to the unpacked bytes, whatever the wrapping. A bare file
// passed as-is, without being measured: the ceiling only held for compressed ones.
#[test]
fn the_size_ceiling_holds_whatever_the_envelope() {
    let bare = file(&sdna(&["value"], 1), 0);
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    std::io::Write::write_all(&mut encoder, &bare).expect("compression");
    let zipped = encoder.finish().expect("gzip frame");
    for (case, bytes) in [("nu", &bare), ("gzip", &zipped)] {
        assert_eq!(
            under(bytes, bare.len() - 1),
            "blend-too-large",
            "{case}: the unpacked bytes exceed the ceiling"
        );
    }
    BlendFile::open(&bare, bare.len()).expect("under the ceiling, the bare file opens");
}

// Finding 27: cancellation is reread inside a mesh. Checked between objects only, a scene of a
// single object of a million faces posed that million before stopping.
#[test]
fn a_raised_token_stops_a_mesh_before_its_last_face() {
    let geometry = Geometry {
        positions: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
        corners: vec![0, 1, 2],
        offsets: vec![0, 3],
        uv: Vec::new(),
        material: vec![0],
        sharp: vec![true],
        sharp_corners: Vec::new(),
    };
    let normals = normals::corners(&geometry.surface()).normals;
    let mut out = Out::default();
    let refusal = build::mesh_json(
        &geometry,
        &normals,
        &[None],
        "M",
        &mut out,
        &AtomicBool::new(true),
    )
    .expect_err("the mesh was expected to be abandoned");
    assert_eq!(refusal.code, "CANCELLED");
}
