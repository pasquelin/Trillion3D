//! The world super-roots wear their objects' attributes: every page a `WGP3` page with the
//! normals and texture coordinates of its covers, mirrored faces turned to the front; a placed
//! object is one cluster, one nothing groups given a parent of its own. On generated plates.
use super::tests::{cooked, plate};
use super::*;
use super::{decoded::decoded, world::world_dag};
use crate::dag::{build_dag_tallied, DagAttributes, Grown, DAG_CLUSTER_TRIANGLES};
use crate::geometry_page::{Attribute, FLAG_NORMAL, FLAG_UV};
use trillion3d_math::matrix::{multiply_matrix4_from_zero, scaling, translation};
use trillion3d_math::vec3::{cross, dot, sub};

/// Per vertex of `positions`, the sum of the normals of the faces of `indices` around it.
fn vertex_normals(positions: &[f32], indices: &[u32]) -> Vec<f32> {
    let at = |v: u32| [0, 1, 2].map(|a| f64::from(positions[v as usize * 3 + a]));
    let mut normals = vec![0.0f32; positions.len()];
    for &[a, b, c] in indices.as_chunks::<3>().0 {
        let face = cross(sub(at(b), at(a)), sub(at(c), at(a)));
        for v in [a, b, c] {
            (0..3).for_each(|k| normals[v as usize * 3 + k] += face[k] as f32);
        }
    }
    for n in normals.as_chunks_mut::<3>().0 {
        let length = n
            .iter()
            .map(|x| x * x)
            .sum::<f32>()
            .sqrt()
            .max(f32::MIN_POSITIVE);
        n.iter_mut().for_each(|x| *x /= length);
    }
    normals
}

/// The root cover of a plate carrying normals and a texture set spanning [0, 1].
fn textured(n: usize, size: f32) -> RootCover {
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
    let (dag, .., grown) =
        build_dag_tallied(&positions, attributes, &indices, strategy, &|| Ok(())).expect("dag");
    let (pos, carried) = Grown::arrays(&grown, &positions, attributes);
    let pages = vec![json!({"stream": 0}); dag.len()];
    let page_of: Vec<usize> = (0..dag.len()).collect();
    RootCover::of(strategy, &dag, (pos, &carried), &pages, &page_of)
}

/// `side` × `side` plates 40 m apart in one cell, every other one mirrored on x.
fn field(cover: &RootCover, side: usize) -> Vec<Instance<'_>> {
    (0..side * side)
        .map(|k| {
            let at = translation([(k % side) as f64 * 40.0, 0.0, (k / side) as f64 * 40.0]);
            let flip = scaling([if k % 2 == 1 { -1.0 } else { 1.0 }, 1.0, 1.0]);
            let matrix = multiply_matrix4_from_zero(&at, &flip);
            Instance {
                cell: 0,
                node: k,
                slot: k,
                primitive: 0,
                material: Some(0),
                matrix,
                cover,
            }
        })
        .collect()
}

#[test]
fn a_super_root_page_is_a_geometry_page_wearing_its_objects_attributes() {
    let cover = textured(16, 12.0);
    let instances = field(&cover, 6);
    let cooked = cooked(&instances, 1, WORLD_TOP_BUDGET_BYTES).expect("cooked");
    let table = decoded(&cooked);
    let (pages, bundles) = (table["pages"].as_array().unwrap(), &table["bundles"]);
    assert!(pages.len() > 1, "the objects are continued");
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
            FLAG_NORMAL | FLAG_UV,
            "the covers' attributes"
        );
        let (positions, normals) = (decoded.attribute(0).unwrap(), decoded.attribute(1).unwrap());
        let uv = decoded.attribute(2).unwrap();
        assert!(
            uv.iter().all(|&t| (-1e-3..=1.0 + 1e-3).contains(&t)),
            "texture coordinates kept"
        );
        // Every face turns the way its corners' normals do, mirrored objects included.
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

/// A plate's root cover written by hand: every triangle a root, cut into clusters of a hundred.
fn wide_cover() -> RootCover {
    let (positions, indices) = plate(16, 12.0, false);
    let values = vertex_normals(&positions, &indices);
    let carried = vec![Attribute {
        flag: FLAG_NORMAL,
        width: 3,
        values,
    }];
    let root = |part: &[u32]| RootCluster {
        indices: part.to_vec(),
        error: 0.01,
        sphere: [6.0, 0.0, 6.0, 9.0],
        bundle: 0,
    };
    let clusters = indices.chunks(300).map(root).collect();
    RootCover {
        positions,
        carried,
        clusters,
    }
}

#[test]
fn a_placed_object_is_one_cluster_and_always_has_a_world_parent() {
    let (cover, wide) = (textured(8, 6.0), wide_cover());
    let mut instances = field(&cover, 4);
    // Alone in its material, its roots more than a page holds: nothing groups it.
    let (material, node) = (Some(9), 99);
    instances.push(Instance {
        material,
        node,
        ..field(&wide, 1).remove(0)
    });
    let world = world_dag(&instances, &|| Ok(())).expect("world");
    let objects: Vec<usize> = (0..world.clusters.len())
        .filter(|&id| world.origins[id].is_some())
        .collect();
    assert_eq!(
        objects.len(),
        instances.len(),
        "one cluster per placed object"
    );
    for &id in &objects {
        let (cluster, placed) = (&world.clusters[id], &instances[world.origins[id].unwrap()]);
        let triangles: usize = placed
            .cover
            .clusters
            .iter()
            .map(|c| c.indices.len() / 3)
            .sum();
        assert_eq!(
            (cluster.level, cluster.triangles()),
            (0, triangles),
            "its whole root cover"
        );
        let group = &world.groups[cluster.group.expect("a world parent")];
        assert!(cluster.lod_error <= group.error);
    }
    // The lone object's parent: a copy of it at its error, in clusters a page holds, its stand-ins.
    let id = objects[objects.len() - 1];
    let group = &world.groups[world.clusters[id].group.unwrap()];
    assert_eq!(group.children.as_slice(), [id].as_slice());
    let copies = group.outputs.iter().map(|&o| &world.clusters[o]);
    assert_eq!(copies.clone().map(|c| c.triangles()).sum::<usize>(), 512);
    assert!(group.outputs.len() > 1, "more than one page");
    for copy in copies {
        assert!(copy.triangles() <= DAG_CLUSTER_TRIANGLES && copy.lod_error == group.error);
        assert!(copy.is_root() && copy.level == 1);
    }
}
