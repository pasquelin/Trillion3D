//! KHR_materials_variants keeps primitive-local bindings, including materials not worn by default.
use super::*;
const EXTENSION: &str = "KHR_materials_variants";

pub(super) fn names(g: &Value) -> Result<Vec<String>> {
    let Some(extension) = g.pointer("/extensions/KHR_materials_variants") else {
        return Ok(Vec::new());
    };
    let variants = extension
        .get("variants")
        .and_then(Value::as_array)
        .filter(|values| !values.is_empty())
        .ok_or_else(|| invalid("KHR_materials_variants.variants must be an array"))?;
    let mut names = Vec::with_capacity(variants.len());
    for variant in variants {
        let name = variant
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("material variant requires a name"))?;
        names.push(name.to_string());
    }
    Ok(names)
}

pub(super) fn bindings(g: &Value, p: &Value, surfaces: &mut Materials) -> Result<Value> {
    let Some(extension) = p.get("extensions").and_then(|e| e.get(EXTENSION)) else {
        return Ok(Value::Null);
    };
    let names = names(g)?;
    let mappings = extension
        .get("mappings")
        .and_then(Value::as_array)
        .filter(|values| !values.is_empty())
        .ok_or_else(|| invalid("material variant mappings must be an array"))?;
    let mut bindings = BTreeMap::new();
    for mapping in mappings {
        let material = required_index(mapping.get("material"), "variant material")?;
        let variants = mapping
            .get("variants")
            .and_then(Value::as_array)
            .filter(|values| !values.is_empty())
            .ok_or_else(|| invalid("material mapping variants must be an array"))?;
        let mut selected = p.clone();
        selected["material"] = json!(material);
        let rank = surfaces.rank(g, &selected)?;
        for variant in variants {
            let id = required_index(Some(variant), "material variant index")?;
            if id >= names.len() || bindings.insert(id, rank).is_some() {
                return Err(invalid(
                    "material variant index is out of range or mapped twice",
                ));
            }
        }
    }
    Ok(json!(bindings
        .into_iter()
        .map(|(variant, material)| json!({"variant":variant,"material":material}))
        .collect::<Vec<_>>()))
}
