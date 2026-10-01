//! Admitted PLY attribute schema; unsupported attributes are refused, never discarded.
use super::*;
pub(super) fn add(
    elements: &mut [Element],
    name: &str,
    scalar: Scalar,
    list: Option<Scalar>,
) -> Result<()> {
    let element = elements
        .last_mut()
        .ok_or_else(|| source::invalid("ply", "property has no element"))?;
    if element.properties.iter().any(|p| p.name == name) {
        return Err(source::invalid("ply", "duplicate property"));
    }
    let known = match element.name.as_str() {
        "vertex" => {
            [
                "x",
                "y",
                "z",
                "nx",
                "ny",
                "nz",
                "red",
                "green",
                "blue",
                "alpha",
                "u",
                "v",
                "s",
                "t",
                "texture_u",
                "texture_v",
            ]
            .contains(&name)
                && list.is_none()
        }
        "face" => {
            ((name == "vertex_indices" || name == "vertex_index")
                && list.is_some()
                && scalar.integral())
                || (name == "material_index" && list.is_none() && scalar.integral())
        }
        "material" => ["red", "green", "blue", "alpha"].contains(&name) && list.is_none(),
        _ => false,
    };
    if !known {
        return Err(source::unsupported(
            "ply",
            format!("{}.{} property", element.name, name),
        ));
    }
    element.properties.push(Property {
        name: name.into(),
        scalar,
        list,
    });
    Ok(())
}
pub(super) fn validate(elements: &[Element]) -> Result<()> {
    for element in elements {
        let has = |name: &str| element.properties.iter().any(|p| p.name == name);
        let groups: &[&[&str]] = match element.name.as_str() {
            "vertex" => &[
                &["x", "y", "z"],
                &["nx", "ny", "nz"],
                &["red", "green", "blue"],
                &["u", "v"],
                &["s", "t"],
                &["texture_u", "texture_v"],
            ],
            "material" => &[&["red", "green", "blue"]],
            _ => &[],
        };
        for group in groups {
            if group.iter().any(|p| has(p)) && !group.iter().all(|p| has(p)) {
                return Err(source::invalid("ply", "incomplete attribute tuple"));
            }
        }
        if element.name == "vertex"
            && (!has("x") || ["u", "s", "texture_u"].iter().filter(|n| has(n)).count() > 1)
        {
            return Err(source::invalid(
                "ply",
                "missing positions or ambiguous UV attributes",
            ));
        }
        if element.name == "face" && has("vertex_indices") == has("vertex_index") {
            return Err(source::invalid(
                "ply",
                "face needs exactly one vertex index list",
            ));
        }
        if element.name == "material" && !has("red") {
            return Err(source::invalid("ply", "material has no colour"));
        }
        if has("alpha") && !has("red") {
            return Err(source::invalid("ply", "alpha without colour"));
        }
    }
    Ok(())
}
