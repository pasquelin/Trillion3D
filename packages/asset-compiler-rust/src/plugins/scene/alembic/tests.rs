//! What the Alembic reader recognises, composes and refuses, without going through the whole compiler.
//! What it produces from a real archive is proven in the golden `src/tests/formats/alembic_golden.rs`.

use super::kind::{kind_of, Kind};
use super::ogawa::MAGIC;
use super::*;

mod geometry;
use std::fs;

/// A throwaway file carrying these bytes, named by the case that uses it.
fn written(tag: &str, bytes: &[u8]) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "trillion3d-alembic-{tag}-{}-{}.abc",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    fs::write(&path, bytes).expect("test file");
    path
}

/// The refusal code of these bytes read as an archive.
fn refused(tag: &str, bytes: &[u8]) -> &'static str {
    let path = written(tag, bytes);
    let code = Archive::open(&path)
        .err()
        .unwrap_or_else(|| panic!("{tag}: these bytes were expected to be refused"))
        .code;
    fs::remove_file(&path).expect("cleanup");
    code
}

// Behaviour: the HDF5 container header, Alembic's historical wrapping, is refused under its own
// name — not as a corrupted file, since the file is healthy and simply of another wrapping, and
// not as an unknown format, since its extension did bring it here.
#[test]
fn an_hdf5_alembic_file_is_refused_under_its_own_name() {
    assert_eq!(
        refused("hdf5", b"\x89HDF\r\n\x1a\n\0\0\0\0\0\0\0\0"),
        HDF5_UNSUPPORTED
    );
}

// Behaviour: a truncated file or one without an Ogawa header is refused without panicking,
// whatever the truncation — after the magic number, in the middle of the root address, or in
// the root group itself.
#[test]
fn a_truncated_archive_is_refused_without_panicking() {
    assert_eq!(refused("empty", b""), FILE_INVALID);
    assert_eq!(
        refused("magic", b"not an alembic file at all"),
        FILE_INVALID
    );
    assert_eq!(refused("head", b"Ogawa\xff\x00\x01\x00\x00"), FILE_INVALID);
    // Complete header, but the root group is beyond the end of the file.
    assert_eq!(
        refused("root", b"Ogawa\xff\x00\x01\x40\x00\x00\x00\x00\x00\x00\x00"),
        FILE_INVALID
    );
}

// Behaviour 26: the Ogawa header says three things and all three are read. The freeze flag says
// the writer has finished — an archive left in progress is not read —, and the version, written
// on sixteen bits big-endian, names the format: the corpus one is the first, not the two hundred
// and fifty-sixth that the same byte pair read backwards would give.
#[test]
fn the_ogawa_header_names_a_frozen_archive_of_a_known_version() {
    let head = |frozen: u8, version: [u8; 2]| {
        let mut bytes = MAGIC.to_vec();
        bytes.push(frozen);
        bytes.extend_from_slice(&version);
        bytes.extend_from_slice(&16u64.to_le_bytes());
        bytes.extend_from_slice(&0u64.to_le_bytes());
        bytes
    };
    assert_eq!(refused("non-gelee", &head(0x00, [0, 1])), NOT_FROZEN);
    assert_eq!(refused("version", &head(0xff, [0, 2])), VERSION_UNSUPPORTED);
    // The same byte pair read backwards would be two hundred and fifty-six: it is refused.
    assert_eq!(refused("envers", &head(0xff, [1, 0])), VERSION_UNSUPPORTED);
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/formats/alembic/limites/cases.abc");
    let archive = Archive::open(&path).expect("the corpus opens");
    assert_eq!(archive.file.version, 1, "the corpus version is the first");
}

// Behaviour: a group that declares more children than the allocation ceiling admits is refused
// by name, without the read attempting to reserve the announced memory.
#[test]
fn a_group_above_the_allocation_ceiling_is_refused_by_name() {
    let mut bytes = b"Ogawa\xff\x00\x01".to_vec();
    bytes.extend_from_slice(&16u64.to_le_bytes());
    bytes.extend_from_slice(&u64::MAX.to_le_bytes());
    assert_eq!(refused("ceiling", &bytes), SIZE_UNSUPPORTED);
}

// Behaviour: the schema declared in the metadata names what an object is, and what the driver
// does not convert carries the name under which the report will count it.
#[test]
fn the_schema_metadata_names_what_each_object_is() {
    let kinds = [
        ("schema=AbcGeom_Xform_v3", Kind::Xform),
        ("schema=AbcGeom_PolyMesh_v1;schemaBaseType=x", Kind::Mesh),
        ("schema=AbcGeom_SubD_v1", Kind::SubD),
        ("schema=AbcGeom_FaceSet_v1", Kind::FaceSet),
        (
            "schema=AbcGeom_Curve_v2",
            Kind::Skipped("alembic-curves-unsupported"),
        ),
        (
            "schema=AbcGeom_Points_v1",
            Kind::Skipped("alembic-points-unsupported"),
        ),
        (
            "schema=AbcGeom_NuPatch_v3",
            Kind::Skipped("alembic-nupatch-unsupported"),
        ),
        (
            "schema=AbcGeom_Camera_v1",
            Kind::Skipped("alembic-camera-unsupported"),
        ),
        (
            "schema=AbcGeom_Light_v1",
            Kind::Skipped("alembic-light-unsupported"),
        ),
        ("", Kind::Skipped("alembic-object-unsupported")),
        (
            "isInstance=1;schema=AbcGeom_PolyMesh_v1",
            Kind::Skipped("alembic-instance-unsupported"),
        ),
    ];
    for (meta, expected) in kinds {
        assert_eq!(kind_of(meta), expected, "{meta}");
    }
}

// Behaviour: an `Xform` operation stack composes the glTF matrix. A `matrix` operation enters
// as-is — the two conventions cancel —, and a translation, rotation, scale stack does scale
// before rotating then translating.
#[test]
fn an_xform_operation_stack_composes_the_gltf_matrix() {
    let raw: Vec<f64> = (0..16).map(f64::from).collect();
    let matrix = xform::matrix(&[0x30], &raw).expect("matrix");
    assert_eq!(matrix.to_vec(), raw, "a matrix enters as-is");

    // Translation (1, 2, 3), quarter turn around Y, scale 2: a point on X lands on Z.
    let stack = xform::matrix(
        &[0x10, 0x20, 0x00],
        &[1.0, 2.0, 3.0, 0.0, 1.0, 0.0, 90.0, 2.0, 2.0, 2.0],
    )
    .expect("stack");
    let point = |x: f64, y: f64, z: f64| {
        (0..3)
            .map(|row| stack[row] * x + stack[4 + row] * y + stack[8 + row] * z + stack[12 + row])
            .collect::<Vec<f64>>()
    };
    let moved = point(1.0, 0.0, 0.0);
    assert!(
        (moved[0] - 1.0).abs() < 1e-9 && moved[1] == 2.0 && (moved[2] - 1.0).abs() < 1e-9,
        "{moved:?}"
    );
}

// Behaviour: an unknown operation or a stack longer than its values is refused by name rather
// than composed askew.
#[test]
fn a_malformed_operation_stack_is_refused_by_name() {
    for (ops, values) in [
        (&[0x70u8][..], &[0.0f64][..]),
        (&[0x10][..], &[1.0, 2.0][..]),
    ] {
        let refusal =
            xform::matrix(ops, values).expect_err("this stack was expected to be refused");
        assert_eq!(refusal.code, VALUES_INVALID);
    }
}
