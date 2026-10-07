//! Format numbers of the compiler. The cache it writes and the source manifest it reads are two
//! different formats and move on their own schedules; nothing may conflate them.
use serde_json::Value;

/// Cache format this compiler writes. Format 5 added `scene-tables.json`, the node and material
/// tables the prepared scene is described by; format 7 writes `selectedNodes` as a count, not a
/// list (#404); format 9 makes `clusters.json` the fixed-size root of a page tree (#762); format 11
/// writes no second, self-contained scene (`scene.gltf`) beside the pages, nor its manifest field
/// (#1483). A cache written before any of them is refused by its number, never half-read.
pub const FORMAT_VERSION: u32 = 11;
/// Outer cache format required for clustered BLEND: 8 before the manifest was paged, 10 before
/// format 11.
pub const CLUSTERED_BLEND_FORMAT_VERSION: u32 = 12;
/// Format of a prepared source manifest the compiler reads. An input format, not an output one.
pub const SOURCE_FORMAT_VERSION: u32 = 1;

/// Cache format this compilation writes: a single clustered BLEND primitive is
/// enough to ask the reader for the outer format that carries it.
pub(crate) fn cache_format(primitives: &[Value]) -> u32 {
    match primitives
        .iter()
        .any(|primitive| primitive["pass"] == "clustered-blend")
    {
        true => CLUSTERED_BLEND_FORMAT_VERSION,
        false => FORMAT_VERSION,
    }
}

/// What this compilation did not deliver: the compiler's permanent limits, and
/// simplification when it was not requested.
pub(crate) fn unsupported(simplification: &str) -> Vec<&'static str> {
    let mut out = Vec::new();
    if simplification == "none" {
        out.push("simplification");
    }
    out.extend(["hard RSS enforcement", "N-API binding"]);
    out
}
