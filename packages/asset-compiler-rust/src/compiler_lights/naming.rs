//! The name under which a light is adjusted from the host. It comes from the source file and must stay the
//! same from one compilation to another: the host uses it to find the light it turns off.
use super::*;

/// A unique and stable identifier: the light's or node's name, otherwise its rank, and a suffix
/// when two nodes bear the same name. The host uses it to adjust or remove the light.
pub(super) fn unique_id(
    light: &Value,
    node: &Value,
    index: usize,
    seen: &mut BTreeSet<String>,
) -> String {
    let named = |value: &Value| {
        value
            .get("name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
    };
    let base = named(light)
        .or_else(|| named(node))
        .unwrap_or_else(|| format!("gltf-light-{index}"));
    let mut id = base.clone();
    let mut suffix = 2;
    while !seen.insert(id.clone()) {
        id = format!("{base}#{suffix}");
        suffix += 1;
    }
    id
}
