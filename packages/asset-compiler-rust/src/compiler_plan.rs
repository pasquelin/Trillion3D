use super::*;

pub(super) struct BufferPlan {
    pub accessors: BTreeSet<usize>,
    pub jobs: Vec<(usize, usize)>,
    pub access_map: BTreeMap<usize, usize>,
    pub views: BTreeSet<usize>,
    pub view_map: BTreeMap<usize, usize>,
    pub estimated_working_bytes: usize,
}

pub(super) fn plan_buffers(
    o: &Options,
    g: &Value,
    bin: &[u8],
    g_bytes: &[u8],
    meshes: &BTreeSet<usize>,
) -> Result<BufferPlan> {
    let mesh_values = values(g, "meshes")?;
    let accessor_values = values(g, "accessors")?;
    let view_values = values(g, "bufferViews")?;
    let mut accessors = BTreeSet::new();
    let mut jobs = Vec::new();
    for old in meshes {
        for (primitive, p) in values(item(mesh_values, *old, "mesh")?, "primitives")?
            .iter()
            .enumerate()
        {
            if let Some(indices) = p.get("indices") {
                accessors.insert(required_index(Some(indices), "primitive.indices")?);
            }
            let attributes = p
                .get("attributes")
                .and_then(Value::as_object)
                .ok_or_else(|| invalid("primitive.attributes is required"))?;
            if !attributes.contains_key("POSITION") {
                return Err(invalid("primitive.attributes.POSITION is required"));
            }
            for a in attributes.values() {
                accessors.insert(required_index(Some(a), "primitive attribute")?);
            }
            if let Some(targets) = p.get("targets").and_then(Value::as_array) {
                for target in targets {
                    if let Some(t_obj) = target.as_object() {
                        for a in t_obj.values() {
                            accessors
                                .insert(required_index(Some(a), "primitive target attribute")?);
                        }
                    }
                }
            }
            jobs.push((*old, primitive));
        }
    }
    if let Some(skins) = g.get("skins").and_then(Value::as_array) {
        for skin in skins {
            if let Some(ibm) = skin.get("inverseBindMatrices") {
                accessors.insert(required_index(Some(ibm), "skin.inverseBindMatrices")?);
            }
        }
    }
    if let Some(animations) = g.get("animations").and_then(Value::as_array) {
        for anim in animations {
            if let Some(samplers) = anim.get("samplers").and_then(Value::as_array) {
                for sampler in samplers {
                    if let Some(inp) = sampler.get("input") {
                        accessors.insert(required_index(Some(inp), "animation sampler input")?);
                    }
                    if let Some(out) = sampler.get("output") {
                        accessors.insert(required_index(Some(out), "animation sampler output")?);
                    }
                }
            }
        }
    }
    let access_map: BTreeMap<usize, usize> = accessors
        .iter()
        .enumerate()
        .map(|(new, old)| (*old, new))
        .collect();
    for id in &accessors {
        accessor_validation::validate(g, bin, *id)?;
    }
    let mut views = BTreeSet::new();
    for a in &accessors {
        let acc = item(accessor_values, *a, "accessor")?;
        if acc.get("bufferView").is_some() {
            views.insert(required_index(
                acc.get("bufferView"),
                "accessor.bufferView",
            )?);
        }
        if let Some(sparse) = acc.get("sparse") {
            let ind_bv = required_index(
                sparse.get("indices").and_then(|i| i.get("bufferView")),
                "sparse.indices.bufferView",
            )?;
            let val_bv = required_index(
                sparse.get("values").and_then(|v| v.get("bufferView")),
                "sparse.values.bufferView",
            )?;
            views.insert(ind_bv);
            views.insert(val_bv);
        }
    }
    if let Some(images) = g.get("images").and_then(Value::as_array) {
        for image in images {
            if image.get("bufferView").is_some() {
                views.insert(required_index(image.get("bufferView"), "image.bufferView")?);
            }
        }
    }
    let view_map: BTreeMap<usize, usize> = views
        .iter()
        .enumerate()
        .map(|(new, old)| (*old, new))
        .collect();
    let mut estimated_working_bytes = g_bytes
        .len()
        .saturating_mul(2)
        .saturating_add(o.threads.saturating_mul(1024 * 1024));
    for id in &views {
        estimated_working_bytes = estimated_working_bytes
            .checked_add(required_index(
                item(view_values, *id, "bufferView")?.get("byteLength"),
                "bufferView.byteLength",
            )?)
            .ok_or_else(|| invalid("Working set overflow"))?;
    }
    for (old, primitive) in &jobs {
        let p = item(
            values(item(mesh_values, *old, "mesh")?, "primitives")?,
            *primitive,
            "primitive",
        )?;
        let count = primitive_triangles(g, p)?
            .checked_mul(3)
            .ok_or_else(|| invalid("Working set overflow"))?;
        estimated_working_bytes = estimated_working_bytes
            .checked_add(
                count
                    .checked_mul(4)
                    .ok_or_else(|| invalid("Working set overflow"))?,
            )
            .ok_or_else(|| invalid("Working set overflow"))?;
    }
    estimated_working_bytes = estimated_working_bytes
        .checked_add(bin.len())
        .ok_or_else(|| invalid("Working set overflow"))?;
    if estimated_working_bytes > o.ram_budget_mb * 1024 * 1024 {
        return Err(CompilerError::new(
            "RAM_ADMISSION_BUDGET_EXCEEDED",
            "Estimated working set exceeds configured budget",
        ));
    }
    Ok(BufferPlan {
        accessors,
        jobs,
        access_map,
        views,
        view_map,
        estimated_working_bytes,
    })
}
