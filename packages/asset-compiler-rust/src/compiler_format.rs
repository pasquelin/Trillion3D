//! Format numbers of the compiler. The cache it writes and the source manifest it reads are two
//! different formats and move on their own schedules; nothing may conflate them.
use serde_json::Value;

/// Cache format this compiler writes. Format 3 adds the per-cluster coplanar depth layer, which a
/// reader must understand before it draws a single cluster: formats 1 and 2 carry no such column
/// and are refused, never half-read.
pub const FORMAT_VERSION: u32 = 3;
/// Outer cache format required for clustered BLEND.
pub const CLUSTERED_BLEND_FORMAT_VERSION: u32 = 4;
/// Format of a prepared source manifest the compiler reads. An input format, not an output one.
pub const SOURCE_FORMAT_VERSION: u32 = 1;

/// Le format du cache que cette compilation écrit : une seule primitive en BLEND groupé suffit à
/// demander au lecteur le format extérieur qui le porte.
pub(crate) fn cache_format(primitives: &[Value]) -> u32 {
    match primitives
        .iter()
        .any(|primitive| primitive["pass"] == "clustered-blend")
    {
        true => CLUSTERED_BLEND_FORMAT_VERSION,
        false => FORMAT_VERSION,
    }
}

/// Ce que cette compilation n'a pas rendu : les limites permanentes du compilateur, la
/// simplification quand elle n'a pas été demandée, et la raison nommée d'un mode autonome refusé.
pub(crate) fn unsupported(
    simplification: &str,
    autonomous: Option<&'static str>,
) -> Vec<&'static str> {
    let mut out = Vec::new();
    if simplification == "none" {
        out.push("simplification");
    }
    out.extend(["hard RSS enforcement", "N-API binding"]);
    out.extend(autonomous);
    out
}
