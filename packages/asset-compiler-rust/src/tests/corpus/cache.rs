//! What the compiled cache guarantees on every case: the refusal it announces, or a source
//! buffer copied byte for byte and a DAG that agrees with the one built in memory.
use super::*;

pub(super) fn check_cache(case: &Case, expect: &Expect, roots_in_memory: &[usize], label: &str) {
    let written = gltf::write(case);
    let result = compile(&written.options, |_| {});
    if let Some(code) = expect.refused {
        let error = result
            .err()
            .unwrap_or_else(|| panic!("{label}: the compiler had to refuse it"));
        assert_eq!(
            error.code, code,
            "{label}: refusal code ({})",
            error.message
        );
        return;
    }
    let result = result.unwrap_or_else(|e| panic!("{label}: compile: {e}"));
    let primitives = result["primitives"].as_array().expect("primitives");
    assert_eq!(
        primitives.len(),
        roots_in_memory.len(),
        "{label}: one primitive per material"
    );
    for (primitive, &roots) in primitives.iter().zip(roots_in_memory) {
        let pages = primitive["pages"].as_array().expect("pages");
        let published = pages.iter().filter(|p| p["parentError"].is_null()).count();
        assert_eq!(published, roots, "{label}: the cache's roots are the DAG's");
    }
    let directory = written
        .options
        .key_directory(result["key"].as_str().expect("key"));
    let source = read_json(&directory.join("source.gltf"));
    let bin = fs::read(directory.join("source.bin")).expect("source.bin");
    let views = source["bufferViews"].as_array().expect("bufferViews");
    assert_eq!(
        views.len(),
        written.views.len(),
        "{label}: every source view is read"
    );
    for (view, &(offset, length)) in views.iter().zip(&written.views) {
        let start = view["byteOffset"].as_u64().unwrap_or(0) as usize;
        let len = view["byteLength"].as_u64().expect("byteLength") as usize;
        assert_eq!(len, length, "{label}: a view keeps its length");
        assert_eq!(
            &bin[start..start + len],
            &written.bin[offset..offset + length],
            "{label}: source.bin is the source, byte for byte"
        );
    }
}

/// The DAG the compiled cache holds for the case, primitive by primitive: every page's index
/// payload digest and its errors, in page order.
pub(super) fn compiled_dag(case: &Case) -> Vec<Vec<Value>> {
    let written = gltf::write(case);
    let result = compile(&written.options, |_| {}).expect("compile");
    result["primitives"]
        .as_array()
        .expect("primitives")
        .iter()
        .map(|primitive| {
            let pages = primitive["pages"].as_array().expect("pages");
            pages
                .iter()
                .map(|p| json!([p["sha256"], p["lodError"], p["parentError"]]))
                .collect()
        })
        .collect()
}
