//! A chalet of thin closed shapes keeps its walls on every level of its cook (#415). Every cut
//! decodes onto its source, flips no face, and still shows each wall a camera on any axis sees.
use super::chalet_fixture::chalet;
use super::cooked_pages::cooked_page_defects;
use super::silhouette::{cut_defects, Mesh};
use super::*;

/// One node drawing every mesh as a primitive of its own material, positions and normals as `f32`.
fn mesh_fixture(tag: &str, meshes: &[Mesh]) -> (PathBuf, Options) {
    let (mut bin, mut views, mut accessors, mut primitives) = (Vec::new(), vec![], vec![], vec![]);
    let mut push = |bytes: Vec<u8>, accessor: Value| {
        views.push(json!({"buffer":0,"byteOffset":bin.len(),"byteLength":bytes.len()}));
        bin.extend(bytes);
        let mut accessor = accessor;
        accessor["bufferView"] = json!(views.len() - 1);
        accessors.push(accessor);
        accessors.len() - 1
    };
    let vec3 = |points: &[[f64; 3]]| -> Vec<u8> {
        points
            .iter()
            .flatten()
            .flat_map(|&v| (v as f32).to_le_bytes())
            .collect()
    };
    for (material, mesh) in meshes.iter().enumerate() {
        let count = mesh.positions.len();
        let (min, max) = (0..3).fold((vec![], vec![]), |(mut lo, mut hi), a| {
            let values = mesh.positions.iter().map(|p| p[a] as f32);
            lo.push(values.clone().fold(f32::INFINITY, f32::min));
            hi.push(values.fold(f32::NEG_INFINITY, f32::max));
            (lo, hi)
        });
        let position = push(
            vec3(&mesh.positions),
            json!({"componentType":5126,"type":"VEC3","count":count,"min":min,"max":max}),
        );
        let normal = push(
            vec3(&mesh.normals),
            json!({"componentType":5126,"type":"VEC3","count":count}),
        );
        let indices = mesh.indices.iter().flat_map(|v| v.to_le_bytes()).collect();
        let index = push(
            indices,
            json!({"componentType":5125,"type":"SCALAR","count":mesh.indices.len()}),
        );
        primitives.push(json!({"attributes":{"POSITION":position,"NORMAL":normal},"indices":index,"material":material}));
    }
    let materials: Vec<Value> = meshes
        .iter()
        .map(|_| json!({"pbrMetallicRoughness":{"metallicFactor":0.0}}))
        .collect();
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":format!("{tag}.bin"),"byteLength":bin.len()}],
        "bufferViews":views,"accessors":accessors,"meshes":[{"primitives":primitives}],"nodes":[{"mesh":0}],
        "scenes":[{"nodes":[0]}],"scene":0,"materials":materials});
    let triangles = meshes.iter().map(|m| m.indices.len() / 3).sum();
    gltf_fixture(tag, &gltf, &bin, triangles)
}

/// The chalet cooked with simplification, without texture families: the cut is the subject.
fn cook() -> ([Mesh; 2], PathBuf, Options, Value) {
    let meshes = chalet();
    let (root, mut options) = mesh_fixture("chalet", &meshes);
    options.texture_formats = Vec::new();
    let result = compile(&options, |_| {}).expect("compile");
    (meshes, root, options, result)
}

#[test]
fn every_cut_of_a_chalet_of_thin_closed_shapes_keeps_its_walls_facing_out() {
    let (meshes, root, options, result) = cook();
    let objects = options.cache.join("native/objects");
    let primitives = result["primitives"].as_array().expect("primitives");
    assert_eq!(primitives.len(), meshes.len());
    for primitive in primitives {
        let mesh = &meshes[primitive["primitive"].as_u64().expect("primitive") as usize];
        let defects = cooked_page_defects(&objects, primitive);
        assert!(defects.is_empty(), "{defects:#?}");
        let defects = cut_defects(&objects, primitive, mesh);
        assert!(defects.is_empty(), "{defects:#?}");
    }
    let levels = primitives[1]["pages"].as_array().expect("pages").iter();
    let top = levels.filter_map(|p| p["level"].as_u64()).max();
    assert!(top > Some(1), "the wood must coarsen more than once");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn coarse_levels_turned_inside_out_are_reported_flipped_and_lost() {
    let (meshes, root, options, mut result) = cook();
    let objects = options.cache.join("native/objects");
    let wood = &mut result["primitives"][1];
    for page in wood["pages"].as_array_mut().expect("pages") {
        if page["level"].as_u64() == Some(0) {
            continue;
        }
        let object = objects.join(format!("{}.bin", page["sha256"].as_str().expect("sha")));
        let mut indices = fs::read(object).expect("index object");
        // Swapping each triangle's last two corners turns every coarse face around.
        for triangle in indices.chunks_mut(12) {
            let (second, third) = triangle[4..].split_at_mut(4);
            second.swap_with_slice(third);
        }
        let digest = hash(&indices);
        fs::write(objects.join(format!("{digest}.bin")), &indices).expect("flipped");
        page["sha256"] = json!(digest);
    }
    let defects = cut_defects(&objects, wood, &meshes[1]);
    let _ = fs::remove_dir_all(root);
    for defect in ["faces against its normals", "loses"] {
        assert!(
            defects.iter().any(|d| d.contains(defect)),
            "{defect}: {defects:#?}"
        );
    }
}
