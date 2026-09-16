//! Le nom sous lequel une lampe se règle depuis l'hôte. Il sort du fichier source et doit rester le
//! même d'une compilation à l'autre : l'hôte s'en sert pour retrouver la lampe qu'il éteint.
use super::*;

/// Un identifiant unique et stable : le nom de la lampe ou du nœud, sinon son rang, et un suffixe
/// quand deux nœuds portent le même nom. L'hôte s'en sert pour régler ou retirer la lampe.
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
