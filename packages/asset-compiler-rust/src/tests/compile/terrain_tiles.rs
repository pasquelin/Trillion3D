//! A terrain cooked tile by tile decodes back to its source on every level (#414): no page of a
//! heightfield carries a vertex away from its surface, on either simplification.
use super::cooked_pages::cooked_page_defects;
use super::*;
use crate::tests::textures::identity_textures::png_sized;

/// Quads per tile side and their spacing, in metres: a small version of the open world's tiles.
const QUADS: usize = 32;
const SPACING: f32 = 8.0;

/// Height of the terrain at `(x, z)`, in metres: two ridges and a flat valley floor, so the
/// simplification meets both slopes and a plane.
fn height(x: f32, z: f32) -> f32 {
    let ridge = portable_sin(x * 0.011) * portable_sin(z * 0.017 + 1.0) * 60.0;
    ridge.max(-10.0) + 40.0
}

/// Two textured heightfield tiles side by side, each its own mesh and node, with the normals and
/// texture coordinates a terrain generator writes.
fn terrain_fixture(simplification: &str) -> (PathBuf, Options) {
    let side = QUADS + 1;
    let mut bin = Vec::new();
    let mut views = Vec::new();
    let mut accessors = Vec::new();
    let mut meshes = Vec::new();
    let mut nodes = Vec::new();
    let mut push = |bytes: Vec<u8>, accessor: Value| {
        views.push(json!({"buffer":0,"byteOffset":bin.len(),"byteLength":bytes.len()}));
        bin.extend(bytes);
        let mut accessor = accessor;
        accessor["bufferView"] = json!(views.len() - 1);
        accessors.push(accessor);
        accessors.len() - 1
    };
    for tile in 0..2 {
        let origin = tile as f32 * QUADS as f32 * SPACING;
        let (mut positions, mut normals, mut uvs) = (Vec::new(), Vec::new(), Vec::new());
        for row in 0..side {
            for column in 0..side {
                let (x, z) = (column as f32 * SPACING, row as f32 * SPACING);
                let at = |dx: f32, dz: f32| height(origin + x + dx, z + dz);
                let (sx, sz) = (at(1.0, 0.0) - at(-1.0, 0.0), at(0.0, 1.0) - at(0.0, -1.0));
                let length = (sx * sx + 4.0 + sz * sz).sqrt();
                positions.extend([x, at(0.0, 0.0), z]);
                normals.extend([-sx / length, 2.0 / length, -sz / length]);
                uvs.extend([column as f32 / QUADS as f32, row as f32 / QUADS as f32]);
            }
        }
        let indices = grid_indices(QUADS, QUADS, |x, y| (y * side + x) as u32);
        let floats = |values: &[f32]| {
            values
                .iter()
                .flat_map(|v| v.to_le_bytes())
                .collect::<Vec<u8>>()
        };
        let count = side * side;
        let position = push(
            floats(&positions),
            json!({"componentType":5126,"type":"VEC3","count":count}),
        );
        let normal = push(
            floats(&normals),
            json!({"componentType":5126,"type":"VEC3","count":count}),
        );
        let uv = push(
            floats(&uvs),
            json!({"componentType":5126,"type":"VEC2","count":count}),
        );
        let index = push(
            indices.iter().flat_map(|v| v.to_le_bytes()).collect(),
            json!({"componentType":5125,"type":"SCALAR","count":indices.len()}),
        );
        meshes.push(json!({"primitives":[{"attributes":{"POSITION":position,"NORMAL":normal,"TEXCOORD_0":uv},"indices":index,"material":0}]}));
        nodes.push(json!({"mesh":tile,"translation":[origin,0.0,0.0]}));
    }
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":"terrain.bin","byteLength":bin.len()}],
        "bufferViews":views,"accessors":accessors,"meshes":meshes,"nodes":nodes,"scenes":[{"nodes":[0,1]}],"scene":0,
        "materials":[{"pbrMetallicRoughness":{"baseColorTexture":{"index":0},"metallicFactor":0.0}}],
        "textures":[{"source":0}],"images":[{"uri":"terrain.png"}]});
    let (root, mut options) = gltf_fixture("terrain", &gltf, &bin, 2 * QUADS * QUADS * 2);
    fs::write(
        options.source.join("terrain.png"),
        png_sized(8, [90, 120, 60, 255]),
    )
    .expect("png");
    options.simplification = simplification.into();
    options.texture_formats = Vec::new();
    (root, options)
}

fn cook(simplification: &str) -> (PathBuf, Options, Value) {
    let (root, options) = terrain_fixture(simplification);
    let result = compile(&options, |_| {}).expect("compile");
    (root, options, result)
}

#[test]
fn every_page_of_a_cooked_terrain_decodes_onto_its_source_on_both_simplifications() {
    for simplification in ["qem-endpoints", "none"] {
        let (root, options, result) = cook(simplification);
        let primitives = result["primitives"].as_array().expect("primitives");
        assert_eq!(
            primitives.len(),
            2,
            "{simplification}: one primitive per tile"
        );
        for primitive in primitives {
            let top = primitive["pages"]
                .as_array()
                .expect("pages")
                .iter()
                .filter_map(|p| p["level"].as_u64())
                .max();
            assert_eq!(
                top > Some(1),
                simplification != "none",
                "{simplification}: levels {top:?}"
            );
            let defects = cooked_page_defects(&options.cache.join("native/objects"), primitive);
            assert!(defects.is_empty(), "{simplification}: {defects:#?}");
        }
        let _ = fs::remove_dir_all(root);
    }
}

#[test]
fn a_coarse_page_whose_vertex_leaves_the_terrain_is_reported() {
    let (root, options, mut result) = cook("qem-endpoints");
    let objects = options.cache.join("native/objects");
    let primitive = &mut result["primitives"][0];
    let exponent = primitive["quantization"]["positionExponent"]
        .as_i64()
        .expect("exponent") as i32;
    let pages = primitive["pages"].as_array_mut().expect("pages");
    let coarse = pages
        .iter_mut()
        .find(|p| p["level"].as_u64() == Some(1))
        .expect("a coarse page");
    let raw = fs::read(objects.join(format!("{}.bin", coarse["sha256"].as_str().expect("sha"))))
        .expect("index object");
    let source: Vec<u32> = raw
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| u32::from_le_bytes(*b))
        .collect();
    let side = QUADS + 1;
    let mut positions: Vec<f32> = (0..side * side)
        .flat_map(|v| {
            let (x, z) = ((v % side) as f32 * SPACING, (v / side) as f32 * SPACING);
            [x, height(x, z), z]
        })
        .collect();
    // One vertex of the page thrown a kilometre up: a sheet across the sky.
    positions[source[0] as usize * 3 + 1] += 1000.0;
    let page = crate::geometry_page::encode(&source, &positions, &[], exponent).expect("encode");
    let digest = hash(&page.bytes);
    fs::write(objects.join(format!("{digest}.bin")), &page.bytes).expect("page");
    coarse["geometry"]["sha256"] = json!(digest);
    let defects = cooked_page_defects(&objects, &result["primitives"][0]);
    let _ = fs::remove_dir_all(root);
    for defect in [
        "decodes",
        "outside its bounds",
        "outside its sphere",
        "leaves group",
    ] {
        assert!(
            defects.iter().any(|d| d.contains(defect)),
            "{defect}: {defects:#?}"
        );
    }
}
