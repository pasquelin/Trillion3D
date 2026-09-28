use super::*;

/// A POSITION without `bufferView`, described only by a one-element sparse, but
/// announcing `count` dense elements. Stored bytes fit in 28: three indices, one
/// sparse index, one sparse value. The dense expansion is `count × 3` floats.
fn sparse_position_fixture(count: u64) -> (PathBuf, Options) {
    let (root, mut options) = fixture();
    let mut bin = Vec::new();
    for value in [0u32, 1, 2] {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    bin.extend_from_slice(&0u32.to_le_bytes());
    for value in [0f32, 0., 0.] {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":"mesh.bin","byteLength":bin.len()}],
        "bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":12},{"buffer":0,"byteOffset":12,"byteLength":4},{"buffer":0,"byteOffset":16,"byteLength":12}],
        "accessors":[{"componentType":5126,"type":"VEC3","count":count,"sparse":{"count":1,"indices":{"bufferView":1,"componentType":5125},"values":{"bufferView":2}}},{"bufferView":0,"componentType":5125,"type":"SCALAR","count":3}],
        "meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],"nodes":[{"mesh":0},{"mesh":0}],"materials":[],"images":[]});
    fs::write(options.source.join("mesh.bin"), &bin).expect("bin write");
    write_gltf(&options, &gltf, Some(&bin));
    options.scope = "full".into();
    options.triangle_budget = 150000;
    (root, options)
}

/// A01: `count = 2^61` fits in a `usize`, so neither admission nor validation
/// sees it pass; only the dense reservation of `count × 3` floats used to notice,
/// by panicking.
#[test]
fn a01_a_sparse_position_of_2_pow_61_is_refused_without_panic() {
    let (root, options) = sparse_position_fixture(1u64 << 61);
    let error = compile(&options, |_| {}).expect_err("the hostile accessor must be refused");
    assert!(
        error.code == "INVALID_GLTF" || error.code == "RAM_ADMISSION_BUDGET_EXCEEDED",
        "{error}"
    );
    fs::remove_dir_all(root).expect("cleanup");
}

/// A01 bis: a realistic sparse, whose dense expansion exceeds the 64 MiB budget
/// without overflowing any integer, must be refused by admission and not allocated.
#[test]
fn a01_a_realistic_sparse_over_budget_is_refused_by_admission() {
    let (root, options) = sparse_position_fixture(8_000_000);
    let error = compile(&options, |_| {}).expect_err("the dense expansion exceeds the budget");
    assert_eq!(error.code, "RAM_ADMISSION_BUDGET_EXCEEDED", "{error}");
    fs::remove_dir_all(root).expect("cleanup");
}

/// #50: a scene admitted before waves existed is never refused for what its primitives keep
/// (a page record per cluster). Two primitives of 600,000 triangles store about 7 MiB of
/// indices each; their page records leave the 64 MiB budget no room, so they compile one at
/// a time instead of being refused.
#[test]
fn primitives_whose_kept_pages_leave_no_room_compile_one_at_a_time() {
    let (root, mut options) = fixture();
    let triangles = 600_000usize;
    let mut bin = Vec::with_capacity(triangles * 12 + 36);
    for _ in 0..triangles {
        for value in [0u32, 1, 2] {
            bin.extend_from_slice(&value.to_le_bytes());
        }
    }
    for value in [0f32, 0., 0., 1., 0., 0., 0., 1., 0.] {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    let primitive = json!({"attributes":{"POSITION":0},"indices":1});
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":"mesh.bin","byteLength":bin.len()}],
        "bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":triangles * 12},{"buffer":0,"byteOffset":triangles * 12,"byteLength":36}],
        "accessors":[{"bufferView":1,"componentType":5126,"type":"VEC3","count":3,"min":[0,0,0],"max":[1,1,0]},{"bufferView":0,"componentType":5125,"type":"SCALAR","count":triangles * 3}],
        "meshes":[{"primitives":[primitive, primitive]}],"nodes":[{"mesh":0}],"materials":[],"images":[]});
    fs::write(options.source.join("mesh.bin"), &bin).expect("bin write");
    write_gltf(&options, &gltf, Some(&bin));
    options.scope = "full".into();
    let result = compile(&options, |_| {}).expect("the scene cooks in smaller waves");
    assert_eq!(result["status"], "ready", "{result}");
    assert_eq!(
        result["metrics"]["compileWaves"], 2,
        "{}",
        result["metrics"]
    );
    fs::remove_dir_all(root).expect("cleanup");
}
