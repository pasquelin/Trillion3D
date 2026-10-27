//! Curves in an Alembic archive, through the whole compiler: an archive written in memory
//! (`alembic_writer.rs`) holds the strands of a groom, the router sends it to the driver, and the
//! compiler builds the groom and writes it as `hairStrands.bin`. The manifest's `hairStrands` section
//! is what these cases read. Arrays, scopes and counts are proven where they are read, in
//! `alembic/tests/curves.rs` and `hair_strands/tests.rs`.
use super::alembic_writer::{Child, Ogawa, Prop, POD_F32, POD_F64, POD_I32, POD_U8};
use super::*;

const CURVES: &str = "schema=AbcGeom_Curve_v2";
const XFORM: &str = "schema=AbcGeom_Xform_v3";

/// The little-endian bytes of single-precision `values`.
fn floats(values: &[f32]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

/// The little-endian bytes of `values`, thirty-two bits each.
fn integers(values: &[i32]) -> Vec<u8> {
    values
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

/// The properties of a curves object of two curves, of three and two points, each with a width of
/// 0.02 given once; `ids` gives the group number of each curve as a parameter of each curve.
fn curves(ogawa: &mut Ogawa, ids: Option<&[i32]>) -> u64 {
    let points = [
        [0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 2.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 1.0, 0.0],
    ];
    let mut geom = vec![
        Prop::Array {
            name: "P",
            pod: POD_F32,
            extent: 3,
            meta: "",
            values: floats(&points.concat()),
        },
        Prop::Array {
            name: "nVertices",
            pod: POD_I32,
            extent: 1,
            meta: "",
            values: integers(&[3, 2]),
        },
        Prop::Array {
            name: "width",
            pod: POD_F32,
            extent: 1,
            meta: "geoScope=con",
            values: floats(&[0.02]),
        },
    ];
    if let Some(ids) = ids {
        geom.push(Prop::Compound {
            name: ".arbGeomParams",
            children: vec![Prop::Array {
                name: "groom_group_id",
                pod: POD_I32,
                extent: 1,
                meta: "geoScope=uni",
                values: integers(ids),
            }],
        });
    }
    ogawa.properties(&[Prop::Compound {
        name: ".geom",
        children: geom,
    }])
}

/// The properties of a transform that translates by `by`.
fn translated(ogawa: &mut Ogawa, by: [f64; 3]) -> u64 {
    ogawa.properties(&[Prop::Compound {
        name: ".xform",
        children: vec![
            Prop::Array {
                name: ".ops",
                pod: POD_U8,
                extent: 1,
                meta: "",
                values: vec![0x10],
            },
            Prop::Array {
                name: ".vals",
                pod: POD_F64,
                extent: 1,
                meta: "",
                values: by.iter().flat_map(|value| value.to_le_bytes()).collect(),
            },
        ],
    }])
}

/// Compiles the archive `bytes` and answers the compiler's manifest.
fn compile_archive(bytes: &[u8], tag: &str) -> Value {
    let dir = scratch("alembic", tag);
    let source = dir.join("hair.abc");
    fs::write(&source, bytes).expect("archive");
    let answer = compile_golden_answer(&source, tag);
    fs::remove_dir_all(&dir).expect("cleanup");
    answer
}

// Behaviour: an archive of curves and no mesh is a groom, as the reference imports one: it is
// compiled with no mesh, its curves are cut into groups by the group numbers they carry, in the order
// the groups are met, and each curve is given the control point at its end. Two curves of three and
// two points make seven points; the file is the head, two records, the curves, the points, two seeds
// and two lengths, each table padded to a word.
#[test]
fn an_archive_of_curves_alone_is_compiled_as_a_groom() {
    let mut ogawa = Ogawa::new();
    let properties = curves(&mut ogawa, Some(&[5, 7]));
    let hair = ogawa.object(properties, &[]);
    let placed = translated(&mut ogawa, [1.0, 0.0, 0.0]);
    let groom = ogawa.object(
        placed,
        &[Child {
            name: "hair",
            meta: CURVES,
            group: hair,
        }],
    );
    let bytes = ogawa.archive(&[Child {
        name: "groom",
        meta: XFORM,
        group: groom,
    }]);
    let answer = compile_archive(&bytes, "groom-alone");
    assert_eq!(answer["selectedNodes"], 0, "no mesh is compiled");
    let section = &answer["hairStrands"];
    assert_eq!(section["curves"], 2);
    assert_eq!(section["points"], 7);
    assert_eq!(
        section["groups"],
        json!([
            {"groupId": 5, "curves": 1, "points": 4, "flags": 24},
            {"groupId": 7, "curves": 1, "points": 3, "flags": 24},
        ]),
        "the groups in the order they are met, shuffled, with the ending point"
    );
    assert_eq!(section["bytes"], 16 + 2 * 80 + 8 + 7 * 8 + 4 + 4);
}

// Behaviour: an object that instances curves is read in place, one copy for each instance, each
// placed by the transforms above it: two objects of two curves each, one of them an instance of the
// other, make four curves in the one group.
#[test]
fn an_instance_of_curves_is_a_groom_of_its_own() {
    let mut ogawa = Ogawa::new();
    let properties = curves(&mut ogawa, None);
    let hair = ogawa.object(properties, &[]);
    let (near, far) = (
        translated(&mut ogawa, [0.0, 0.0, 0.0]),
        translated(&mut ogawa, [5.0, 0.0, 0.0]),
    );
    let first = ogawa.object(
        near,
        &[Child {
            name: "hair",
            meta: CURVES,
            group: hair,
        }],
    );
    let second = ogawa.object(
        far,
        &[Child {
            name: "again",
            meta: "isInstance=1;schema=AbcGeom_Curve_v2",
            group: hair,
        }],
    );
    let bytes = ogawa.archive(&[
        Child {
            name: "first",
            meta: XFORM,
            group: first,
        },
        Child {
            name: "second",
            meta: XFORM,
            group: second,
        },
    ]);
    let answer = compile_archive(&bytes, "groom-instance");
    let section = &answer["hairStrands"];
    assert_eq!(section["curves"], 4);
    assert_eq!(section["points"], 14);
    assert_eq!(
        section["groups"],
        json!([{"groupId": 0, "curves": 4, "points": 14, "flags": 24}])
    );
}

// Behaviour: a curves object that carries no `.geom`, or none of whose curves its points cover, is
// no groom: a scene of nothing else is refused as a scene that holds nothing to draw.
#[test]
fn an_archive_of_empty_curves_alone_is_refused_as_empty() {
    let mut ogawa = Ogawa::new();
    let properties = ogawa.properties(&[]);
    let hair = ogawa.object(properties, &[]);
    let bytes = ogawa.archive(&[Child {
        name: "hair",
        meta: CURVES,
        group: hair,
    }]);
    let dir = scratch("alembic", "groom-empty");
    let source = dir.join("hair.abc");
    fs::write(&source, bytes).expect("archive");
    assert_eq!(
        refused_golden_source(&source, "groom-empty"),
        "IMPORT_EMPTY"
    );
    fs::remove_dir_all(&dir).expect("cleanup");
}
