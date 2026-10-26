//! A mesh that names height maps is baked by the compile itself: at the default budget, whatever
//! the mesh's size, and each primitive by the map of its rank.
use super::*;

/// A PNG of 3 × 3 texels whose height, the first channel, is 1 at the centre and 0 elsewhere.
fn bump_png() -> Vec<u8> {
    let image = image::RgbaImage::from_fn(3, 3, |x, y| {
        let height = if (x, y) == (1, 1) { 255 } else { 0 };
        image::Rgba([height, height, height, 255])
    });
    let mut bytes = Vec::new();
    let mut out = std::io::Cursor::new(&mut bytes);
    image
        .write_to(&mut out, image::ImageFormat::Png)
        .expect("png");
    bytes
}

/// `quads` primitives of one mesh, each a quad of two triangles 1 m on a side facing up, 5 m from
/// the one before, with its normals and its texture coordinates; the texture 0 is the bump, held
/// in the binary.
fn quads_fixture(tag: &str, quads: usize) -> (PathBuf, Options) {
    let (mut bin, mut views, mut accessors, mut primitives) = (Vec::new(), vec![], vec![], vec![]);
    let mut view = |bin: &mut Vec<u8>, floats: &[f32], words: &[u32]| {
        let at = bin.len();
        bin.extend(floats.iter().flat_map(|x| x.to_le_bytes()));
        bin.extend(words.iter().flat_map(|x| x.to_le_bytes()));
        views.push(json!({"buffer":0,"byteOffset":at,"byteLength":bin.len() - at}));
        views.len() - 1
    };
    for quad in 0..quads {
        let left = 5.0 * quad as f32;
        let corners = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
        let positions: Vec<f32> = (corners.iter())
            .flat_map(|&(x, y)| [left + x, y, 0.0])
            .collect();
        let normals = [0.0, 0.0, 1.0].repeat(4);
        let uvs: Vec<f32> = corners.iter().flat_map(|&(x, y)| [x, y]).collect();
        let first = accessors.len();
        for (floats, kind, count) in [
            (&positions, "VEC3", 4),
            (&normals, "VEC3", 4),
            (&uvs, "VEC2", 4),
        ] {
            let at = view(&mut bin, floats, &[]);
            accessors.push(json!({"bufferView":at,"componentType":5126,"type":kind,"count":count}));
        }
        accessors[first]["min"] = json!([left, 0.0, 0.0]);
        accessors[first]["max"] = json!([left + 1.0, 1.0, 0.0]);
        let at = view(&mut bin, &[], &[0, 1, 2, 0, 2, 3]);
        accessors.push(json!({"bufferView":at,"componentType":5125,"type":"SCALAR","count":6}));
        primitives.push(
            json!({"attributes":{"POSITION":first,"NORMAL":first + 1,"TEXCOORD_0":first + 2},
            "indices":first + 3}),
        );
    }
    let png = bump_png();
    let image = view(&mut bin, &[], &[]);
    bin.extend(&png);
    views[image]["byteLength"] = json!(png.len());
    let gltf = json!({"asset":{"version":"2.0"},
        "buffers":[{"uri":format!("{tag}.bin"),"byteLength":bin.len()}],
        "bufferViews":views,"accessors":accessors,
        "images":[{"bufferView":image,"mimeType":"image/png"}],"textures":[{"source":0}],
        "meshes":[{"primitives":primitives}],"nodes":[{"mesh":0}],"scenes":[{"nodes":[0]}],"scene":0});
    gltf_fixture(tag, &gltf, &bin)
}

/// The triangles each primitive of `result` was compiled from.
fn triangles(result: &Value) -> Vec<u64> {
    let primitives = result["primitives"].as_array().expect("primitives");
    (primitives.iter())
        .map(|p| p["triangles"].as_u64().expect("triangles"))
        .collect()
}

/// `options` baking the first map of a 20 cm bump into the mesh's triangles, down to a trimmed error
/// of 1 %, and the second, of no magnitude, into the second primitive's, at the default budget.
fn baking(options: Options) -> Options {
    let maps = [(0, 0.2), (0, 0.0)]
        .map(|(index, magnitude)| json!({"texture":{"index":index},"magnitude":magnitude}));
    let job = json!({"trimmedError":1.0,"displacementMaps":maps});
    Options {
        ram_budget_mb: crate::DEFAULT_RAM_BUDGET_MB,
        mesh_build: crate::MeshBuildOptions::read(Some(&job)),
        ..options
    }
}

// Behaviour: a two-triangle plane with a height texture compiles at the default budget, tessellated
// where the bump bends it. The charge of its bake follows the room: it is not that of the most
// triangles a tessellation may make, which no budget the job is given holds beside its textures.
#[test]
fn a_displaced_plane_compiles_at_the_default_budget() {
    let (root, options) = quads_fixture("displaced-plane", 1);
    let result = compile(&baking(options), |_| {}).expect("the plane compiles");
    assert!(triangles(&result)[0] > 2, "{:?}", triangles(&result));
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a mesh of two primitives bakes as well, each by the map of its rank: the first is
// tessellated by the bump, the second, whose map displaces nothing, keeps its two triangles.
#[test]
fn each_primitive_of_a_mesh_is_baked_by_the_map_of_its_rank() {
    let (root, options) = quads_fixture("displaced-pair", 2);
    let result = compile(&baking(options), |_| {}).expect("the pair compiles");
    let counts = triangles(&result);
    assert!(counts[0] > 2, "{counts:?}");
    assert_eq!(counts[1], 2, "{counts:?}");
    fs::remove_dir_all(root).expect("cleanup");
}
