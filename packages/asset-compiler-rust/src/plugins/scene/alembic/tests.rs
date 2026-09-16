//! Ce que le lecteur Alembic reconnaît, compose et refuse, sans passer par le compilateur entier.
//! Ce qu'il produit d'une vraie archive se prouve dans la dorée `src/tests/alembic_golden.rs`.

use super::kind::{kind_of, Kind};
use super::ogawa::MAGIC;
use super::*;

mod geometry;
use std::fs;

/// Un fichier jetable portant ces octets, nommé par le cas qui l'utilise.
fn written(tag: &str, bytes: &[u8]) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "wg-alembic-{tag}-{}-{}.abc",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    fs::write(&path, bytes).expect("fichier de test");
    path
}

/// Le code de refus de ces octets lus comme une archive.
fn refused(tag: &str, bytes: &[u8]) -> &'static str {
    let path = written(tag, bytes);
    let code = Archive::open(&path)
        .err()
        .unwrap_or_else(|| panic!("{tag} : ces octets devaient être refusés"))
        .code;
    fs::remove_file(&path).expect("nettoyage");
    code
}

// Comportement : l'entête du conteneur HDF5, l'emballage historique d'Alembic, est refusé sous son
// propre nom — pas comme un fichier corrompu, puisque le fichier est sain et simplement d'un autre
// emballage, et pas comme un format inconnu, puisque son extension l'a bien amené ici.
#[test]
fn an_hdf5_alembic_file_is_refused_under_its_own_name() {
    assert_eq!(
        refused("hdf5", b"\x89HDF\r\n\x1a\n\0\0\0\0\0\0\0\0"),
        HDF5_UNSUPPORTED
    );
}

// Comportement : un fichier tronqué ou sans entête Ogawa est refusé sans paniquer, quelle que soit
// la troncature — après le nombre magique, au milieu de l'adresse de la racine, ou dans le groupe
// racine lui-même.
#[test]
fn a_truncated_archive_is_refused_without_panicking() {
    assert_eq!(refused("empty", b""), FILE_INVALID);
    assert_eq!(
        refused("magic", b"not an alembic file at all"),
        FILE_INVALID
    );
    assert_eq!(refused("head", b"Ogawa\xff\x00\x01\x00\x00"), FILE_INVALID);
    // Entête complète, mais le groupe racine est au-delà de la fin du fichier.
    assert_eq!(
        refused("root", b"Ogawa\xff\x00\x01\x40\x00\x00\x00\x00\x00\x00\x00"),
        FILE_INVALID
    );
}

// Comportement 26 : l'entête Ogawa dit trois choses et les trois sont lues. Le drapeau de gel dit
// que l'écrivain a fini — une archive laissée en plan ne se lit pas —, et la version, écrite sur
// seize bits en gros-boutien, dit le format : celle du corpus est la première, pas la deux cent
// cinquante-sixième que donnerait la même paire d'octets lue à l'envers.
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
    // La même paire d'octets lue à l'envers vaudrait deux cent cinquante-six : elle est refusée.
    assert_eq!(refused("envers", &head(0xff, [1, 0])), VERSION_UNSUPPORTED);
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/alembic/limites/cases.abc");
    let archive = Archive::open(&path).expect("le corpus s'ouvre");
    assert_eq!(archive.file.version, 1, "la version du corpus est la première");
}

// Comportement : un groupe qui déclare plus d'enfants que le plafond d'allocation n'en admet est
// refusé par son nom, sans que la lecture tente de réserver la mémoire annoncée.
#[test]
fn a_group_above_the_allocation_ceiling_is_refused_by_name() {
    let mut bytes = b"Ogawa\xff\x00\x01".to_vec();
    bytes.extend_from_slice(&16u64.to_le_bytes());
    bytes.extend_from_slice(&u64::MAX.to_le_bytes());
    assert_eq!(refused("ceiling", &bytes), SIZE_UNSUPPORTED);
}

// Comportement : le schéma déclaré dans la métadonnée dit ce qu'un objet est, et ce que le pilote
// ne convertit pas porte le nom sous lequel le rapport le comptera.
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

// Comportement : la pile d'opérations d'un `Xform` compose la matrice du glTF. Une opération
// `matrix` entre telle quelle — les deux conventions se compensent —, et une pile translation,
// rotation, échelle met bien à l'échelle avant de tourner puis de déplacer.
#[test]
fn an_xform_operation_stack_composes_the_gltf_matrix() {
    let raw: Vec<f64> = (0..16).map(f64::from).collect();
    let matrix = xform::matrix(&[0x30], &raw).expect("matrice");
    assert_eq!(matrix.to_vec(), raw, "une matrice entre telle quelle");

    // Translation (1, 2, 3), quart de tour autour de Y, échelle 2 : un point sur X passe en Z.
    let stack = xform::matrix(
        &[0x10, 0x20, 0x00],
        &[1.0, 2.0, 3.0, 0.0, 1.0, 0.0, 90.0, 2.0, 2.0, 2.0],
    )
    .expect("pile");
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

// Comportement : une opération inconnue ou une pile plus longue que ses valeurs est refusée par son
// nom plutôt que composée de travers.
#[test]
fn a_malformed_operation_stack_is_refused_by_name() {
    for (ops, values) in [
        (&[0x70u8][..], &[0.0f64][..]),
        (&[0x10][..], &[1.0, 2.0][..]),
    ] {
        let refusal = xform::matrix(ops, values).expect_err("cette pile devait être refusée");
        assert_eq!(refusal.code, VALUES_INVALID);
    }
}
