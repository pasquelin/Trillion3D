//! A coarse level never destroys a part (#484): the root cover — what `memory-on-a-budget` draws
//! at its smallest budget — holds every part of the model, and every root face lies on the model.
//! On `signature-architecture`, the roots had lost the paving, the plinths, the arcades' roofs and
//! columns, and a fan of faces turned from the light filled every arch opening. The cook refuses
//! a parent error below a child's, so a cook that passes keeps its errors monotone.
use super::chalet_fixture::{push_box, push_log};
use super::dag_dependency_scenes::cook_site_scene;
use super::silhouette::{page_indices, Mesh};
use super::thin_walls::mesh_fixture;
use super::*;
use crate::dag::bounds::bounding_sphere;
use crate::dag::clusters::weld_positions;
use crate::dag::vanished::parts;
use crate::physics_cook::hausdorff::one_sided_distance;
use std::collections::HashSet;

/// The root cover's defects against the source it was cooked from, one line each: a part none of
/// whose vertices a root page names, and a root page with a face farther from the source than
/// twice its error — the error is the simplifier's, a distance to the planes of the faces it
/// replaced, which the distance to the triangles themselves may exceed on a curved part.
fn root_cover_defects(
    objects: &Path,
    primitive: &Value,
    positions: &[f32],
    indices: &[u32],
) -> Vec<String> {
    let index = &primitive["primitive"];
    let mut defects = Vec::new();
    let mut named = HashSet::new();
    let pages = primitive["pages"].as_array().expect("pages");
    for page in pages.iter().filter(|page| page["parentError"].is_null()) {
        let drawn = page_indices(objects, page);
        let error = page["lodError"].as_f64().expect("error");
        let off = one_sided_distance(positions, &drawn, indices);
        if off > 2.0 * error + 1e-6 {
            let id = &page["id"];
            defects.push(format!(
                "primitive {index}, root page {id}: a face lies {off:.3} m off the model, error {error:.3} m"
            ));
        }
        named.extend(drawn);
    }
    for part in parts(indices, &weld_positions(positions, indices)) {
        if !part.iter().any(|v| named.contains(v)) {
            let sphere = bounding_sphere(positions, &part);
            defects.push(format!(
                "primitive {index}: the part around {:.2?}, {:.2} m across, is not in the root cover",
                &sphere[..3],
                2.0 * sphere[3]
            ));
        }
    }
    defects
}

/// One glTF accessor of four-byte components, decoded.
fn read<T>(gltf: &Value, bin: &[u8], accessor: &Value, decode: fn([u8; 4]) -> T) -> Vec<T> {
    let accessor = &gltf["accessors"][accessor.as_u64().expect("accessor") as usize];
    let view = &gltf["bufferViews"][accessor["bufferView"].as_u64().expect("view") as usize];
    let offset = view["byteOffset"].as_u64().unwrap_or(0) as usize
        + accessor["byteOffset"].as_u64().unwrap_or(0) as usize;
    let width = if accessor["type"] == "VEC3" { 3 } else { 1 };
    let count = accessor["count"].as_u64().expect("count") as usize * width;
    let bytes = &bin[offset..offset + count * 4];
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| decode(*b))
        .collect()
}

#[test]
fn the_root_cover_of_signature_architecture_holds_every_part_on_the_model() {
    let folder = "site/assets/gallery/signature-architecture/source";
    let (root, options, gltf, bin, result) = cook_site_scene(folder, "geometry.gltf", "geometry");
    let objects = options.cache.join("native/objects");
    let mut defects = Vec::new();
    for primitive in result["primitives"].as_array().expect("primitives") {
        let index = primitive["primitive"].as_u64().expect("primitive") as usize;
        let written = &gltf["meshes"][0]["primitives"][index];
        let position = &written["attributes"]["POSITION"];
        let positions = read(&gltf, &bin, position, f32::from_le_bytes);
        let indices = read(&gltf, &bin, &written["indices"], u32::from_le_bytes);
        defects.extend(root_cover_defects(
            &objects, primitive, &positions, &indices,
        ));
    }
    let _ = fs::remove_dir_all(root);
    assert!(defects.is_empty(), "{defects:#?}");
}

/// An arcade: a slab, two rows of twenty columns 0.24 m wide and 4 m tall, and a lintel on each
/// row. Every part is a closed solid with the normals an exporter writes.
fn arcade() -> Mesh {
    let mut mesh = Mesh::default();
    push_box(&mut mesh, [-20.0, -0.2, -3.0], [20.0, 0.0, 3.0]);
    for z in [-2.0f32, 2.0] {
        for k in 0..20 {
            push_log(&mut mesh, 1, [-19.0 + 2.0 * k as f32, 0.0, z], 4.0);
        }
        push_box(&mut mesh, [-20.0, 4.0, z - 0.3], [20.0, 4.3, z + 0.3]);
    }
    mesh
}

#[test]
fn the_root_cover_of_an_arcade_keeps_every_column() {
    let mesh = arcade();
    let (root, mut options) = mesh_fixture("arcade", std::slice::from_ref(&mesh));
    options.texture_formats = Vec::new();
    let result = compile(&options, |_| {}).expect("compile");
    let objects = options.cache.join("native/objects");
    let positions: Vec<f32> = mesh.positions.iter().flatten().map(|&v| v as f32).collect();
    let primitive = &result["primitives"][0];
    let defects = root_cover_defects(&objects, primitive, &positions, &mesh.indices);
    let top = primitive["pages"].as_array().expect("pages").iter();
    let top = top.filter_map(|page| page["level"].as_u64()).max();
    let _ = fs::remove_dir_all(root);
    assert!(defects.is_empty(), "{defects:#?}");
    assert!(top > Some(1), "the arcade must coarsen more than once");
}
