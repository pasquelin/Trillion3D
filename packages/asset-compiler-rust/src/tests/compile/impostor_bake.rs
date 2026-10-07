//! An impostor is judged on the triangles its mesh draws at its coarsest — the root cover — and
//! never on the stall summary's level-0 roots, which are zero once the DAG climbs: read there, every
//! repeated mesh was refused as cheaper than its own card.
use super::*;
use crate::compiler_primitive_warn::root_cover_triangles;
use crate::import::f32_bytes;

/// Placements a side of the square the mesh is laid on, and the gap between two, metres: far
/// enough apart that the scene's reach passes the depth past which the root outnumbers its pixels.
const SIDE: usize = 4;
const GAP: f32 = 4000.0;

/// A rolling grid of `n`² cells (`2n²` triangles, a DAG that climbs to a few roots), its one mesh
/// placed `SIDE`² times over a square `GAP` apart.
fn repeated_grid(n: usize) -> (PathBuf, Options) {
    let mut positions = Vec::new();
    for y in 0..=n {
        for x in 0..=n {
            let height = portable_sin(x as f32 * 0.31) * portable_sin(y as f32 * 0.27) * 3.0;
            positions.extend([x as f32, height, y as f32]);
        }
    }
    let indices = grid_indices(n, n, |x, y| (y * (n + 1) + x) as u32);
    let mut bin = f32_bytes(&positions);
    bin.extend(indices.iter().flat_map(|v| v.to_le_bytes()));
    let (positions_bytes, index_bytes) = (positions.len() * 4, indices.len() * 4);
    let nodes: Vec<Value> = (0..SIDE * SIDE)
        .map(|k| json!({"mesh":0,"translation":[(k % SIDE) as f32 * GAP, 0.0, (k / SIDE) as f32 * GAP]}))
        .collect();
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":"rolling.bin","byteLength":bin.len()}],
        "bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":positions_bytes},
            {"buffer":0,"byteOffset":positions_bytes,"byteLength":index_bytes}],
        "accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":positions.len()/3},
            {"bufferView":1,"componentType":5125,"type":"SCALAR","count":indices.len()}],
        "meshes":[{"name":"rolling","primitives":[{"attributes":{"POSITION":0},"indices":1}]}],
        "nodes":nodes,"scenes":[{"nodes":(0..SIDE * SIDE).collect::<Vec<_>>()}],"scene":0});
    gltf_fixture("rolling", &gltf, &bin)
}

// Behaviour: a mesh placed sixteen times over a wide square, whose DAG climbs (no level-0 root),
// bakes; its entry names the triangles its root cover draws, the same the primitive's levels
// publish, and more than zero.
#[test]
fn a_repeated_mesh_whose_dag_climbs_bakes_on_its_root_cover() {
    let (root, options) = repeated_grid(32);
    let result = compile(&options, |_| {}).expect("compile");
    let primitive = &result["primitives"][0];
    assert_eq!(primitive["dag"]["rootTriangles"], 0, "the DAG climbs");
    let cover = root_cover_triangles(&primitive["dag"]);
    let entry = &result["impostors"]["meshes"][0];
    assert_eq!(entry["status"], "baked", "{entry}");
    assert_eq!(entry["rootTriangles"].as_u64(), Some(cover as u64));
    assert!(cover > 0, "a root cover draws triangles");
    assert_eq!(result["impostors"]["baked"], 1);
    fs::remove_dir_all(root).expect("cleanup");
}
