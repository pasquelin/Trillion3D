//! A chalet of thin closed shapes keeps its walls on every level of its cook (#415). Every cut
//! decodes onto its source, flips no face, and still shows each wall a camera on any axis sees.
use super::chalet_fixture::chalet;
use super::coarse_normals::foreign_normal_defects;
use super::cooked_pages::cooked_page_defects;
use super::silhouette::{cut_defects, Mesh};
use super::*;

/// One node drawing every mesh as a primitive of its own material, positions and normals as `f32`.
pub(super) fn mesh_fixture(tag: &str, meshes: &[Mesh]) -> (PathBuf, Options) {
    let (mut buffer, mut primitives) = (GltfBuffer::default(), vec![]);
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
        let position = buffer.push(
            vec3(&mesh.positions),
            json!({"componentType":5126,"type":"VEC3","count":count,"min":min,"max":max}),
        );
        let normal = buffer.push(
            vec3(&mesh.normals),
            json!({"componentType":5126,"type":"VEC3","count":count}),
        );
        let indices = mesh.indices.iter().flat_map(|v| v.to_le_bytes()).collect();
        let index = buffer.push(
            indices,
            json!({"componentType":5125,"type":"SCALAR","count":mesh.indices.len()}),
        );
        primitives.push(json!({"attributes":{"POSITION":position,"NORMAL":normal},"indices":index,"material":material}));
    }
    let materials: Vec<Value> = meshes
        .iter()
        .map(|_| json!({"pbrMetallicRoughness":{"metallicFactor":0.0}}))
        .collect();
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":format!("{tag}.bin"),"byteLength":buffer.bin.len()}],
        "bufferViews":buffer.views,"accessors":buffer.accessors,"meshes":[{"primitives":primitives}],"nodes":[{"mesh":0}],
        "scenes":[{"nodes":[0]}],"scene":0,"materials":materials});
    gltf_fixture(tag, &gltf, &buffer.bin)
}

/// The chalet cooked with simplification, without texture families: the cut is the subject.
fn cook() -> ([Mesh; 3], PathBuf, Options, Value) {
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
        let positions: Vec<f32> = mesh.positions.iter().flatten().map(|&v| v as f32).collect();
        let defects = cooked_page_defects(&objects, primitive, &positions);
        assert!(defects.is_empty(), "{defects:#?}");
        let defects = cut_defects(&objects, primitive, mesh);
        assert!(defects.is_empty(), "{defects:#?}");
        let defects = foreign_normal_defects(&objects, primitive, mesh);
        assert!(defects.is_empty(), "{defects:#?}");
    }
    for (primitive, name) in [(1, "wood"), (2, "roof")] {
        let levels = primitives[primitive]["pages"]
            .as_array()
            .expect("pages")
            .iter();
        let top = levels.filter_map(|p| p["level"].as_u64()).max();
        assert!(top > Some(1), "the {name} must coarsen more than once");
    }
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
/// Digest of what the chalet cooks to: every page, its objects by digest, its errors and bounds.
const CHALET_COOK: &str = "76b848008816559d6c7afe52f47cd84bae78cebd0154d7f85d207d491edbcfb5";

/// The cook is the same bytes on every platform: its cache keys and every test above depend on
/// it. A different digest on one platform alone is a cook that is not portable (the C++ of
/// meshoptimizer fused into FMA on arm64 cooked three faces apart from x86_64); a different
/// digest everywhere is a cook that changed, and the constant follows it.
#[test]
fn the_chalet_cooks_to_the_same_bytes_on_every_platform() {
    let (_, root, _, result) = cook();
    let digest = hash(&serde_json::to_vec(&result["primitives"]).expect("primitives"));
    let _ = fs::remove_dir_all(root);
    assert_eq!(digest, CHALET_COOK);
}
