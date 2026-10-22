//! The world's HLOD wears its objects' attributes: every page a `WGP3` page with the normals and
//! texture coordinates of its covers and its shell's tangents, mirrored faces turned to the front.
//! On generated plates.
use super::decoded::decoded;
use super::{cooked, plate};
use crate::dag::{build_dag, DagAttributes, DagStrategy, Grown, DAG_CLUSTER_TRIANGLES};
use crate::hlod::chain::*;
use trillion3d_math::matrix::{multiply_matrix4_from_zero, scaling, translation};
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{self, dot, sub};
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_NORMAL, FLAG_TANGENT, FLAG_UV};

/// Per vertex of `positions`, the sum of the normals of the faces of `indices` around it.
pub(crate) fn vertex_normals(positions: &[f32], indices: &[u32]) -> Vec<f32> {
    let at = |v: u32| [0, 1, 2].map(|a| f64::from(positions[v as usize * 3 + a]));
    let mut normals = vec![0.0f32; positions.len()];
    for &[a, b, c] in indices.as_chunks::<3>().0 {
        let face = cross(sub(at(b), at(a)), sub(at(c), at(a)));
        for v in [a, b, c] {
            (0..3).for_each(|k| normals[v as usize * 3 + k] += face[k] as f32);
        }
    }
    for n in normals.as_chunks_mut::<3>().0 {
        let length = vecn::length(*n).max(f32::MIN_POSITIVE);
        n.iter_mut().for_each(|x| *x /= length);
    }
    normals
}

/// The source cover of a plate carrying normals and a texture set spanning [0, 1].
fn textured(n: usize, size: f32) -> SourceCover {
    let (positions, indices) = plate(n, size, false);
    let uv = positions
        .as_chunks::<3>()
        .0
        .iter()
        .flat_map(|p| [p[0] / size, p[2] / size]);
    let carried = [
        Attribute {
            flag: FLAG_NORMAL,
            width: 3,
            values: vertex_normals(&positions, &indices),
        },
        Attribute {
            flag: FLAG_UV,
            width: 2,
            values: uv.collect(),
        },
    ];
    let refs: Vec<&Attribute> = carried.iter().collect();
    let attributes = DagAttributes { carried: &refs };
    let strategy = DagStrategy::QemEndpoints;
    let built = build_dag(&positions, attributes, &indices, strategy, &|| Ok(())).expect("dag");
    let (dag, grown) = ((&built.clusters[..], &built.groups[..]), built.grown);
    let (pos, carried) = Grown::arrays(&grown, &positions, attributes);
    SourceCover::of(dag, (pos, &carried), None).expect("cover")
}

/// `side` × `side` plates 40 m apart in one cell, every other one mirrored on x.
pub(crate) fn field(cover: &SourceCover, side: usize) -> Vec<Instance<'_>> {
    (0..side * side)
        .map(|k| {
            let at = translation([(k % side) as f64 * 40.0, 0.0, (k / side) as f64 * 40.0]);
            let flip = scaling([if k % 2 == 1 { -1.0 } else { 1.0 }, 1.0, 1.0]);
            let matrix = multiply_matrix4_from_zero(&at, &flip);
            Instance {
                hlod: 0,
                material: Some(0),
                matrix,
                cover,
                instanced: false,
                node: k,
                mesh: 0,
                track: None,
            }
        })
        .collect()
}

#[test]
fn an_hlod_page_is_a_geometry_page_wearing_its_objects_attributes() {
    let cover = textured(16, 12.0);
    let instances = field(&cover, 6);
    let cooked = cooked(&instances, 1).expect("cooked");
    let table = decoded(&cooked);
    let (pages, bundles) = (table["pages"].as_array().unwrap(), &table["bundles"]);
    assert!(pages.len() > 1, "the actors are paged");
    // HLOD 1's shell at its full detail: the clusters of the HLOD 0 cells' actors.
    let cell_level =
        |c: &Value| &table["hlod"][c["hlod"].as_u64().expect("its cell") as usize]["level"];
    let shell: Vec<(Value, Value)> = (table["clusters"].as_array().unwrap().iter())
        .filter(|c| *cell_level(c) == json!(0) && c["level"] == json!(0))
        .map(|c| (c["bundle"].clone(), c["offset"].clone()))
        .collect();
    // Per page, by its bundle and offset, the error of the cluster it draws.
    let error_of = |page: &Value| -> f64 {
        (table["clusters"].as_array().unwrap().iter())
            .find(|c| c["bundle"] == page["bundle"] && c["offset"] == page["offset"])
            .and_then(|c| c["lodError"].as_f64())
            .unwrap_or(0.0)
    };
    for page in pages {
        let bundle = &bundles[page["bundle"].as_u64().expect("bundle") as usize];
        let start =
            (bundle["offset"].as_u64().unwrap() + page["offset"].as_u64().unwrap()) as usize;
        let bytes = &cooked.payload[start..start + page["bytes"].as_u64().unwrap() as usize];
        let decoded = trillion3d_page_codec::decode(bytes, 1 << 24).expect("a WGP3 page");
        assert!(
            decoded.index_count <= 3 * DAG_CLUSTER_TRIANGLES,
            "a page a visibility id holds"
        );
        assert_eq!(
            decoded.flags,
            FLAG_NORMAL | FLAG_UV | FLAG_TANGENT,
            "the covers' attributes and the shell's tangents"
        );
        let (positions, normals) = (decoded.attribute(0).unwrap(), decoded.attribute(1).unwrap());
        let uv = decoded.attribute(2).unwrap();
        // The covers' coordinates span [0, 1] over 12 m. A simplified level solves its own, never
        // held to that range: they stay within it by the cluster's error, in texture units.
        let margin = 1e-3 + error_of(page) / 12.0;
        assert!(
            uv.iter()
                .all(|&t| (-margin..=1.0 + margin).contains(&f64::from(t))),
            "texture coordinates kept"
        );
        // Every face of the shell, built from mirrored objects too, turns the way its corners'
        // normals do; the levels above, and the layers past HLOD 1, are the simplifier's, as any
        // primitive's.
        if !shell.contains(&(page["bundle"].clone(), page["offset"].clone())) {
            continue;
        }
        let at = |v: u32| [0, 1, 2].map(|a| f64::from(positions[v as usize * 3 + a]));
        let normal = |v: u32| [0, 1, 2].map(|a| f64::from(normals[v as usize * 3 + a]));
        for &[a, b, c] in decoded.indices().as_chunks::<3>().0 {
            let face = cross(sub(at(b), at(a)), sub(at(c), at(a)));
            let shaded = [a, b, c]
                .iter()
                .map(|&v| normal(v))
                .fold([0.0; 3], |s, n| [s[0] + n[0], s[1] + n[1], s[2] + n[2]]);
            assert!(dot(face, shaded) >= 0.0, "a face lit from behind");
        }
    }
}
