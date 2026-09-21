use super::*;

pub(super) struct SourceSceneInputs<'a> {
    pub g: &'a Value,
    pub o: &'a Options,
    pub meshes: &'a BTreeSet<usize>,
    pub chosen: &'a BTreeSet<usize>,
    pub mesh_map: &'a BTreeMap<usize, usize>,
    pub accessors: &'a BTreeSet<usize>,
    pub access_map: &'a BTreeMap<usize, usize>,
    pub view_map: &'a BTreeMap<usize, usize>,
    pub directory: &'a Path,
    pub output_views: &'a [Value],
    pub offset: usize,
    /// Primitives whose vertices the DAG rewrote, and the accessors that now read them.
    pub extension: &'a [compiler_source_extend::ExtensionViews],
}

pub(super) fn write_source_scene(inputs: SourceSceneInputs<'_>) -> Result<(Value, Product)> {
    let SourceSceneInputs {
        g,
        o,
        meshes,
        chosen,
        mesh_map,
        accessors,
        access_map,
        view_map,
        directory,
        output_views,
        offset,
        extension,
    } = inputs;
    let mut source = g.clone();
    let mut output_meshes = Vec::new();
    // Accessors of the rewritten primitives, ranked after those the scene keeps.
    let mut extra_accessors: Vec<Value> = Vec::new();
    for id in meshes {
        let mut mesh = item(values(&source, "meshes")?, *id, "mesh")?.clone();
        for (rank, p) in mesh
            .get_mut("primitives")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| invalid("mesh.primitives is required"))?
            .iter_mut()
            .enumerate()
        {
            if p.get("indices").is_some() {
                let old = required_index(p.get("indices"), "primitive.indices")?;
                p["indices"] = json!(*access_map
                    .get(&old)
                    .ok_or_else(|| invalid("Missing accessor mapping"))?);
            }
            if let Some(rewritten) = extension.iter().find(|e| e.primitive == (*id, rank)) {
                let mut attributes = serde_json::Map::new();
                for (name, accessor) in &rewritten.attributes {
                    let rank = accessors.len() + extra_accessors.len();
                    attributes.insert(name.to_string(), json!(rank));
                    extra_accessors.push(accessor.clone());
                }
                p["attributes"] = Value::Object(attributes);
            } else {
                for v in p
                    .get_mut("attributes")
                    .and_then(Value::as_object_mut)
                    .ok_or_else(|| invalid("primitive.attributes is required"))?
                    .values_mut()
                {
                    let old = required_index(Some(v), "primitive attribute")?;
                    *v = json!(*access_map
                        .get(&old)
                        .ok_or_else(|| invalid("Missing accessor mapping"))?);
                }
            }
            if let Some(targets) = p.get_mut("targets").and_then(Value::as_array_mut) {
                for target in targets {
                    if let Some(t_obj) = target.as_object_mut() {
                        for v in t_obj.values_mut() {
                            let old = required_index(Some(v), "primitive target attribute")?;
                            *v = json!(*access_map
                                .get(&old)
                                .ok_or_else(|| invalid("Missing accessor mapping"))?);
                        }
                    }
                }
            }
        }
        output_meshes.push(mesh);
    }
    source["meshes"] = Value::Array(output_meshes);
    for (i, n) in source
        .get_mut("nodes")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| invalid("nodes array is required"))?
        .iter_mut()
        .enumerate()
    {
        if n.get("mesh").is_some() {
            if chosen.contains(&i) {
                let old = required_index(n.get("mesh"), "node.mesh")?;
                n["mesh"] = json!(*mesh_map
                    .get(&old)
                    .ok_or_else(|| invalid("Missing mesh mapping"))?);
            } else {
                n.as_object_mut()
                    .ok_or_else(|| invalid("node object is required"))?
                    .remove("mesh");
            }
        }
    }
    let mut output_accessors = Vec::new();
    for id in accessors {
        let mut a = item(values(&source, "accessors")?, *id, "accessor")?.clone();
        if a.get("bufferView").is_some() {
            let old = required_index(a.get("bufferView"), "accessor.bufferView")?;
            a["bufferView"] = json!(*view_map
                .get(&old)
                .ok_or_else(|| invalid("Missing bufferView mapping"))?);
        }
        if let Some(sparse) = a.get_mut("sparse").and_then(Value::as_object_mut) {
            if let Some(indices) = sparse.get_mut("indices").and_then(Value::as_object_mut) {
                let old = required_index(indices.get("bufferView"), "sparse.indices.bufferView")?;
                indices["bufferView"] = json!(*view_map
                    .get(&old)
                    .ok_or_else(|| invalid("Missing bufferView mapping"))?);
            }
            if let Some(vals) = sparse.get_mut("values").and_then(Value::as_object_mut) {
                let old = required_index(vals.get("bufferView"), "sparse.values.bufferView")?;
                vals["bufferView"] = json!(*view_map
                    .get(&old)
                    .ok_or_else(|| invalid("Missing bufferView mapping"))?);
            }
        }
        output_accessors.push(a);
    }
    output_accessors.extend(extra_accessors);
    source["accessors"] = Value::Array(output_accessors);
    if let Some(skins) = source.get_mut("skins").and_then(Value::as_array_mut) {
        for skin in skins {
            if skin.get("inverseBindMatrices").is_some() {
                let old =
                    required_index(skin.get("inverseBindMatrices"), "skin.inverseBindMatrices")?;
                if let Some(mapped) = access_map.get(&old) {
                    skin["inverseBindMatrices"] = json!(*mapped);
                }
            }
        }
    }
    if let Some(animations) = source.get_mut("animations").and_then(Value::as_array_mut) {
        for anim in animations {
            if let Some(samplers) = anim.get_mut("samplers").and_then(Value::as_array_mut) {
                for sampler in samplers {
                    if let Some(inp) = sampler.get("input") {
                        let old = required_index(Some(inp), "animation sampler input")?;
                        if let Some(mapped) = access_map.get(&old) {
                            sampler["input"] = json!(*mapped);
                        }
                    }
                    if let Some(out) = sampler.get("output") {
                        let old = required_index(Some(out), "animation sampler output")?;
                        if let Some(mapped) = access_map.get(&old) {
                            sampler["output"] = json!(*mapped);
                        }
                    }
                }
            }
        }
    }
    source["bufferViews"] = json!(output_views);
    source["buffers"] = json!([{"uri":"source.bin","byteLength":offset}]);
    rewrite_images(&mut source, &o.resource_base, view_map)?;
    let written = product(directory, "source.gltf", &serde_json::to_vec(&source)?)?;
    Ok((source, written))
}
