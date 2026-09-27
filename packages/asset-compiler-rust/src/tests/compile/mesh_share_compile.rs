//! Two meshes of one content compile to what one mesh placed twice compiles to (#931, CMP-11):
//! the same single primitive, the same pages, collision, proxy and depth layers, both nodes on it;
//! one bit apart, they stay two primitives.
use super::*;
use crate::import::{f32_bytes, Bin};

/// Vertices per side of the bumpy grid: enough triangles for a DAG with simplified levels.
const SIDE: usize = 25;

/// A bumpy grid, each row shifted off the lattice so it cooks as a triangle mesh and not a height
/// field: its positions and triangles as little-endian bytes. Portable sines keep its bits the
/// same on every platform.
fn grid() -> (Vec<u8>, Vec<u8>) {
    let mut positions = Vec::new();
    for (y, x) in (0..SIDE).flat_map(|y| (0..SIDE).map(move |x| (y, x))) {
        let (fx, fy) = (x as f32 * 0.2, y as f32 * 0.2);
        let height = 0.3 * portable_sin(fx * 1.7) * portable_sin(fy * 1.3);
        positions.extend([fx + 0.03 * portable_sin(fy * 3.1), height, fy]);
    }
    let indices = grid_indices(SIDE - 1, SIDE - 1, |x, y| (y * SIDE + x) as u32);
    let indices = indices.iter().flat_map(|i| i.to_le_bytes()).collect();
    (f32_bytes(&positions), indices)
}

/// A scene whose mesh `m` reads the `m`-th copy of the grid's bytes, a node on each copy the
/// scene names in `nodes` (a node's mesh), compiled; its result and written source scene.
fn compiled(tag: &str, copies: &[(Vec<u8>, Vec<u8>)], nodes: &[usize]) -> (Value, Value) {
    let (mut bin, mut accessors, mut meshes) = (Bin::default(), vec![], vec![]);
    for (positions, indices) in copies {
        for (bytes, component, kind, count) in [
            (positions, 5126, "VEC3", positions.len() / 12),
            (indices, 5125, "SCALAR", indices.len() / 4),
        ] {
            let view = bin.view(bytes, None);
            accessors.push(
                json!({"bufferView":view,"componentType":component,"type":kind,"count":count}),
            );
        }
        let at = accessors.len() - 2;
        let name = format!("rock.{at}");
        meshes.push(
            json!({"name":name,"primitives":[{"attributes":{"POSITION":at},"indices":at + 1}]}),
        );
    }
    let nodes: Vec<Value> = (nodes.iter().enumerate())
        .map(|(i, mesh)| json!({"mesh":mesh,"translation":[i as f64 * 7.0, 0.0, 0.0]}))
        .collect();
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":format!("{tag}.bin"),"byteLength":bin.bytes.len()}],
        "bufferViews":bin.views,"accessors":accessors,"meshes":meshes,"nodes":nodes,
        "scenes":[{"nodes":(0..nodes.len()).collect::<Vec<_>>()}],"materials":[],"images":[]});
    let (root, options) = gltf_fixture(tag, &gltf, &bin.bytes);
    let result = compile(&options, |_| {}).expect("compile");
    let directory = options.key_directory(result["key"].as_str().expect("key"));
    let source = read_json(&directory.join("source.gltf"));
    fs::remove_dir_all(root).expect("cleanup");
    (result, source)
}

/// What the cook of a scene is, without what names its source: primitives, collision, proxy and
/// depth layers.
fn cooked(result: &Value) -> Value {
    let fields = ["primitives", "proxy", "coplanar", "physics"];
    json!(fields.map(|field| &result[field]))
}

#[test]
fn two_meshes_of_one_content_cook_as_one_mesh_placed_twice() {
    let copy = grid();
    let (single, single_source) = compiled("single", std::slice::from_ref(&copy), &[0, 0]);
    let (twice, twice_source) = compiled("twice", &[copy.clone(), copy], &[0, 1]);
    assert_eq!(single["primitives"].as_array().map(Vec::len), Some(1));
    assert_eq!(cooked(&twice), cooked(&single), "one cook, the same pages");
    assert_eq!(twice_source["meshes"].as_array().map(Vec::len), Some(1));
    assert_eq!(
        twice_source["nodes"], single_source["nodes"],
        "both nodes on one mesh"
    );
}

#[test]
fn two_meshes_one_bit_apart_cook_as_two() {
    let copy = grid();
    let mut other = copy.clone();
    other.0[7] ^= 0x80; // the first vertex's height, +0 turned -0
    let (twice, _) = compiled("apart", &[copy, other], &[0, 1]);
    assert_eq!(twice["primitives"].as_array().map(Vec::len), Some(2));
}
