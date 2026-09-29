//! Output bits of the Blender driver, pinned to what the compiler wrote before #1150 (merge base
//! `8912566d6`): the fixture posed by hand in every rotation mode, then a skewed roof whose
//! normals no axis rounds for free. A digest that moves means a Blender file compiles to other
//! bits: an output change, never a clean-up.
use super::*;

/// What the pre-#1150 compiler wrote for the posed fixture, then for the skewed roof.
const POSED: &str = "6046edabe0f8cebae681a1d72a60fb2e36bf7bf1611e29e629bccc8235a9c900";
const ROOF: &str = "d69cd9fe25f1404f21749971265c8e853e7c098b623e939dcc47931203828671";

/// SHA-256 of the bits, in order: one string that moves with any of them.
fn digest(bits: impl IntoIterator<Item = u32>) -> String {
    let bytes: Vec<u8> = bits.into_iter().flat_map(u32::to_le_bytes).collect();
    crate::compiler_validate::hash(&bytes)
}

/// The fixture with all edges soft and each object posed in its own rotation mode: quaternion,
/// two Euler orders and axis-angle, each with a deferred rotation, a scale and a position.
fn posed() -> Vec<u8> {
    let mut bytes = surgery::with_sharp_edges(false);
    let writes = {
        let file = BlendFile::open(&bytes, BUDGET).expect("the fixture");
        let objects: Vec<u64> = file.of(*b"OB\0\0").map(|block| block.old).collect();
        assert!(objects.len() >= 4, "three cubes and their empty");
        let floats = |values: &[f32]| values.iter().flat_map(|v| v.to_le_bytes()).collect();
        let mut writes: Vec<(usize, Vec<u8>)> = Vec::new();
        for (rank, &old) in objects.iter().enumerate() {
            let at = |name: &str| surgery::field(&file, old, &[name]);
            let mode: i16 = [0, 1, 5, -1][rank % 4];
            let skew = rank as f32 * 0.137;
            writes.push((at("rotmode"), mode.to_le_bytes().to_vec()));
            writes.push((at("quat"), floats(&[0.9, 0.1 + skew, -0.3, 0.2])));
            writes.push((at("dquat"), floats(&[1.0, 0.05, skew, -0.02])));
            writes.push((at("rot"), floats(&[0.3 + skew, -1.1, 2.2])));
            writes.push((at("drot"), floats(&[0.01, 0.02, -0.03 - skew])));
            writes.push((at("rotAxis"), floats(&[0.2, 0.7 - skew, -0.4])));
            writes.push((at("rotAngle"), floats(&[1.234 + skew])));
            writes.push((at("drotAxis"), floats(&[1.0, 0.3, 0.1 + skew])));
            writes.push((at("drotAngle"), floats(&[0.1])));
            writes.push((at("size"), floats(&[1.1, 0.9 + skew, 1.3])));
            writes.push((at("dscale"), floats(&[1.0, 1.05, 0.95 - skew])));
            writes.push((at("loc"), floats(&[0.3, -0.7 + skew, 1.9])));
        }
        writes
    };
    for (at, value) in writes {
        surgery::put(&mut bytes, at, &value);
    }
    bytes
}

/// Every node matrix, then every normal the driver wrote, as single-float bits.
fn written_bits(bytes: &[u8]) -> Vec<u32> {
    let (root, directory) = output::converted(bytes, "bits-poses", BUDGET);
    let directory = directory.expect("conversion");
    let gltf: Value =
        serde_json::from_slice(&fs::read(directory.join("model.gltf")).expect("gltf"))
            .expect("gltf");
    let uri = gltf["buffers"][0]["uri"].as_str().expect("the binary");
    let bin = fs::read(directory.join(uri)).expect("the binary");
    fs::remove_dir_all(&root).expect("cleanup");
    let mut bits: Vec<u32> = gltf["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .filter_map(|node| node["matrix"].as_array())
        .flatten()
        .map(|value| (value.as_f64().expect("a number") as f32).to_bits())
        .collect();
    let parts = gltf["meshes"].as_array().expect("meshes").iter();
    for part in parts.flat_map(|mesh| mesh["primitives"].as_array().expect("primitives")) {
        let accessor =
            &gltf["accessors"][part["attributes"]["NORMAL"].as_u64().expect("NORMAL") as usize];
        let view = &gltf["bufferViews"][accessor["bufferView"].as_u64().expect("view") as usize];
        let from = (view["byteOffset"].as_u64().unwrap_or(0)
            + accessor["byteOffset"].as_u64().unwrap_or(0)) as usize;
        let count = accessor["count"].as_u64().expect("count") as usize * 3;
        bits.extend(
            bin[from..from + count * 4]
                .chunks_exact(4)
                .map(|word| u32::from_le_bytes(word.try_into().expect("a word"))),
        );
    }
    bits
}

// Audit of #940: the posed fixture's world matrices and normals keep the bits the pre-#1150
// compiler wrote — single-precision composition, `Iterator::sum` included.
#[test]
fn posed_objects_compile_to_the_bits_of_the_pre_1150_compiler() {
    let bits = written_bits(&posed());
    assert_eq!(digest(bits.iter().copied()), POSED, "{bits:08x?}");
}

// Audit of #940: a skewed smooth roof's corner normals, divided in single precision, keep the
// pre-#1150 bits.
#[test]
fn skewed_smooth_normals_keep_the_bits_of_the_pre_1150_compiler() {
    let geometry = Geometry {
        positions: vec![
            0.0, 0.1, 0.03, 0.2, 1.3, -0.1, 1.1, 0.05, 0.93, 0.97, 1.17, 1.21, 2.3, -0.2, 0.1, 2.1,
            0.9, -0.05,
        ],
        corners: vec![0, 2, 3, 1, 2, 4, 5, 3],
        offsets: vec![0, 4, 8],
        uv: Vec::new(),
        material: vec![0, 0],
        sharp: vec![false, false],
        sharp_corners: Vec::new(),
    };
    let normals = computed_normals(&geometry).normals;
    assert_eq!(
        digest(normals.iter().map(|n| n.to_bits())),
        ROOF,
        "{normals:?}"
    );
}
