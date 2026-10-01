//! Surface style STEP IDs remain separate even when their linear RGBA values agree.
use super::*;
pub(super) fn read(all: &Entities, scene: &mut SceneTables) -> Result<BTreeMap<u32, usize>> {
    let mut styles = BTreeMap::new();
    for e in all.values().filter(|e| e.kind == "IFCSURFACESTYLE") {
        let d = &e.data;
        let items = list(d, 2)?;
        if items.len() != 1 {
            return Err(source::unsupported(
                "ifc",
                "multiple surface appearance layers",
            ));
        }
        let shading = entity(
            all,
            items[0]
                .as_entity_ref()
                .ok_or_else(|| invalid("style is not reference"))?,
        )?;
        if !matches!(
            shading.kind.as_str(),
            "IFCSURFACESTYLESHADING" | "IFCSURFACESTYLERENDERING"
        ) {
            return Err(source::unsupported("ifc", &shading.kind));
        }
        if shading.kind == "IFCSURFACESTYLERENDERING"
            && shading
                .data
                .attributes
                .iter()
                .skip(2)
                .any(|v| !matches!(v, Value::Null))
        {
            return Err(source::unsupported(
                "ifc",
                "rendering channels beyond surface colour/transparency",
            ));
        }
        let color = entity(all, reference(&shading.data, 0)?)?;
        if color.kind != "IFCCOLOURRGB" {
            return Err(invalid("surface colour is not RGB"));
        }
        let mut rgba = [1.; 4];
        for (i, c) in rgba[..3].iter_mut().enumerate() {
            *c = number(
                color
                    .data
                    .get(i + 1)
                    .ok_or_else(|| invalid("missing RGB component"))?,
            )? as f32;
        }
        if let Some(v) = shading.data.get(1).filter(|v| !matches!(v, Value::Null)) {
            rgba[3] = 1. - number(v)? as f32;
        }
        if rgba.iter().any(|c| !(0.0..=1.0).contains(c)) {
            return Err(invalid("surface colour/alpha outside range"));
        }
        let mut material = source::material(d.get_string(0).unwrap_or("IFC surface"), rgba);
        match d.get(1).and_then(Value::as_enum) {
            Some("BOTH") => material["doubleSided"] = json!(true),
            Some("POSITIVE") => {}
            _ => {
                return Err(source::unsupported(
                    "ifc",
                    "surface side other than BOTH/POSITIVE",
                ))
            }
        }
        material["extras"] = json!({"ifcSurfaceStyle":d.id});
        styles.insert(d.id, scene.materials.len());
        scene.materials.push(material);
    }
    let mut assigned = BTreeMap::new();
    for e in all.values().filter(|e| e.kind == "IFCSTYLEDITEM") {
        let Some(item) = e.data.get_ref(0) else {
            continue;
        };
        let mut values = Vec::new();
        for value in list(&e.data, 1)? {
            let id = value
                .as_entity_ref()
                .ok_or_else(|| invalid("styled item value not reference"))?;
            let style = entity(all, id)?;
            if style.kind == "IFCPRESENTATIONSTYLEASSIGNMENT" {
                for value in list(&style.data, 0)? {
                    values.push(
                        value
                            .as_entity_ref()
                            .ok_or_else(|| invalid("style assignment not reference"))?,
                    );
                }
            } else {
                values.push(id);
            }
        }
        let [id] = values.as_slice() else {
            return Err(source::unsupported("ifc", "multiple styled item styles"));
        };
        let rank = *styles
            .get(id)
            .ok_or_else(|| source::unsupported("ifc", "non-surface item style"))?;
        if assigned.insert(item, rank).is_some() {
            return Err(invalid("multiple styles for same representation item"));
        }
    }
    Ok(assigned)
}
