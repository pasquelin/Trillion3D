//! Format numbers of the compiler. The cache it writes and the source manifest it reads are two
//! different formats and move on their own schedules; nothing may conflate them.
use crate::shared_math::abi::{CLUSTERED_BLEND_FORMAT_VERSION, FORMAT_VERSION};
use serde_json::Value;

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
