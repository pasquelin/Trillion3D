//! What every `ma` driver case needs: a throwaway Maya ASCII scene written here,
//! a meshed square, and the reading of what the driver made of it.
//!
//! A real fixture would mix ten behaviours; each case therefore writes the
//! minimum that isolates it.
use super::*;

/// Header every Maya ASCII carries, and the unit these cases declare.
const HEAD: &str = "//Maya ASCII 2024 scene\n//Written here from the public documentation of MEL commands: CC0-1.0.\nrequires maya \"2024\";\ncurrentUnit -l centimeter -a degree -t film;\n";

/// A meshed square — two triangles — of this name, under the transform of this path.
pub(super) fn quad(name: &str, parent: &str) -> String {
    format!(
        "createNode mesh -n \"{name}\" -p \"{parent}\";\n\
         \tsetAttr -s 4 \".vt[0:3]\" -type \"float3\" 0 0 0  1 0 0  1 1 0  0 1 0;\n\
         \tsetAttr -s 4 \".ed[0:3]\" 0 1 0  1 2 0  2 3 0  3 0 0;\n\
         \tsetAttr -s 1 \".fc[0:0]\" -type \"polyFaces\"\n\
         \t\tf 4 0 1 2 3;\n"
    )
}

/// A square shaded end to end: the transform, the shape, the shading engine and
/// the two connections Maya writes between a shader, its engine and the whole mesh.
pub(super) fn shaded(name: &str, shader: &str) -> String {
    format!(
        "createNode transform -n \"{name}\";\n{}\
         createNode shadingEngine -n \"{shader}SG\";\n\
         connectAttr \"{shader}.oc\" \"{shader}SG.ss\";\n\
         connectAttr \"{name}Shape.iog\" \"{shader}SG.dsm\" -na;\n",
        quad(&format!("{name}Shape"), name)
    )
}

/// Writes a throwaway scene under the format header and compiles it with the golden harness.
pub(super) fn compile_ma(tag: &str, body: &str) -> GoldenRun {
    let dir = scratch("ma", tag);
    let source = dir.join("scene.ma");
    // The driver does not decode the image: it asks the registry whether this
    // name is readable and whether the file is there. A PNG placed beside it
    // therefore suffices for a throwaway scene's textures to reach the output,
    // without these cases carrying one more image in the repository.
    fs::create_dir_all(dir.join("textures")).expect("image folder");
    fs::write(dir.join("textures/checker.png"), b"\x89PNG\r\n\x1a\n").expect("image");
    fs::write(&source, format!("{HEAD}{body}")).expect("scene");
    let run = compile_golden_source(&source, tag);
    fs::remove_dir_all(&dir).ok();
    run
}

/// Translation of each glTF node of this name, in the order the driver wrote them.
pub(super) fn translations(gltf: &Value, name: &str) -> Vec<[f64; 3]> {
    gltf["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .filter(|node| node["name"] == name)
        .map(|node| matrix(node)[12..15].try_into().expect("translation"))
        .collect()
}

/// Matrix of a glTF node, rounded to the millionth; identity when it carries none.
pub(super) fn matrix(node: &Value) -> Vec<f64> {
    let Some(values) = node["matrix"].as_array() else {
        return crate::compiler_world::IDENTITY.to_vec();
    };
    values
        .iter()
        .map(|value| (value.as_f64().expect("number") * 1e6).round() / 1e6)
        .collect()
}

/// Normals of a primitive of the intermediate scene, read from the binary written beside it.
pub(super) fn normals(run: &GoldenRun, gltf: &Value, part: &Value) -> Vec<[f32; 3]> {
    let rank = part["attributes"]["NORMAL"].as_u64().expect("NORMAL") as usize;
    let accessor = &gltf["accessors"][rank];
    let view = &gltf["bufferViews"][accessor["bufferView"].as_u64().expect("view") as usize];
    let uri = gltf["buffers"][0]["uri"].as_str().expect("the binary");
    let bytes = fs::read(run.prepared_dir("ma").join(uri)).expect("the sidecar");
    let from = (view["byteOffset"].as_u64().unwrap_or(0)
        + accessor["byteOffset"].as_u64().unwrap_or(0)) as usize;
    let count = accessor["count"].as_u64().expect("count") as usize;
    bytes[from..from + count * 12]
        .as_chunks::<12>()
        .0
        .iter()
        .map(|word| {
            let read = |axis: usize| {
                f32::from_le_bytes(word[axis * 4..axis * 4 + 4].try_into().expect("float"))
            };
            [read(0), read(1), read(2)]
        })
        .collect()
}

/// Do two normals look alike to the millionth?
pub(super) fn close(found: [f32; 3], wanted: [f32; 3]) -> bool {
    (0..3).all(|axis| (found[axis] - wanted[axis]).abs() < 1e-6)
}
