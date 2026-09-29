use super::*;

pub(super) struct BufferPlan {
    pub accessors: BTreeSet<usize>,
    pub jobs: Vec<(usize, usize)>,
    pub access_map: BTreeMap<usize, usize>,
    pub views: BTreeSet<usize>,
    pub view_map: BTreeMap<usize, usize>,
    pub estimated_working_bytes: usize,
    /// Consecutive ranges of `jobs` whose working sets fit the job's budget together.
    pub waves: Vec<std::ops::Range<usize>>,
}

/// Bytes an accessor will occupy once decoded into a dense array: `count` elements
/// of `components` four-byte values. An accessor without a `bufferView`, or whose
/// sparse carries only a few values, expands the same way: that expansion is what
/// an allocation will request, never the stored bytes, and it alone can overflow
/// an integer.
fn dense_bytes(acc: &Value) -> Result<usize> {
    let components = match acc.get("type").and_then(Value::as_str) {
        Some("SCALAR") => 1,
        Some("VEC2") => 2,
        Some("VEC3") => 3,
        Some("VEC4") | Some("MAT2") => 4,
        Some("MAT3") => 9,
        Some("MAT4") => 16,
        _ => return Err(invalid("Unsupported accessor type")),
    };
    required_index(acc.get("count"), "accessor.count")?
        .checked_mul(components)
        .and_then(|values| values.checked_mul(4))
        .ok_or_else(|| invalid("Working set overflow"))
}

/// The accessors a primitive reads: its indices, every attribute and every morph target. A
/// primitive without `POSITION` is refused.
fn primitive_accessors(p: &Value, accessors: &mut BTreeSet<usize>) -> Result<()> {
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
    for target in p
        .get("targets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        for a in target.as_object().into_iter().flat_map(|t| t.values()) {
            accessors.insert(required_index(Some(a), "primitive target attribute")?);
        }
    }
    Ok(())
}

pub(super) fn plan_buffers(
    o: &Options,
    g: &Value,
    bin: &[u8],
    source_len: usize,
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
            primitive_accessors(p, &mut accessors).map_err(|e| e.within(*old, primitive))?;
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
    let mut decoded_bytes = 0usize;
    for a in &accessors {
        let acc = item(accessor_values, *a, "accessor")?;
        decoded_bytes = decoded_bytes
            .checked_add(dense_bytes(acc)?)
            .ok_or_else(|| invalid("Working set overflow"))?;
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
    let mut committed = source_len.saturating_mul(2).saturating_add(
        o.threads
            .saturating_mul(compiler_primitive::cost::WORKER_BYTES),
    );
    for id in &views {
        committed = committed
            .checked_add(required_index(
                item(view_values, *id, "bufferView")?.get("byteLength"),
                "bufferView.byteLength",
            )?)
            .ok_or_else(|| invalid("Working set overflow"))?;
    }
    // Index buffers alone can refuse a job (no order lowers them); the rest only shrinks waves.
    let (mut retained, mut working) = (0usize, Vec::with_capacity(jobs.len()));
    for (old, primitive) in &jobs {
        let p = item(
            values(item(mesh_values, *old, "mesh")?, "primitives")?,
            *primitive,
            "primitive",
        )?;
        let cost = compiler_primitive::cost::of(g, p).map_err(|e| e.within(*old, *primitive))?;
        committed = committed
            .checked_add(cost.indices)
            .ok_or_else(|| invalid("Working set overflow"))?;
        retained = retained.saturating_add(cost.retained);
        working.push(cost.working);
    }
    committed = committed
        .checked_add(bin.len())
        .and_then(|total| total.checked_add(decoded_bytes))
        .ok_or_else(|| invalid("Working set overflow"))?;
    if committed > o.ram_budget_bytes() {
        return Err(CompilerError::new(
            "RAM_ADMISSION_BUDGET_EXCEEDED",
            "Estimated working set exceeds configured budget",
        ));
    }
    let held = committed.saturating_add(retained); // what is left sizes the waves
    let waves = compiler_budget::waves::waves(&working, o.ram_budget_bytes().saturating_sub(held));
    Ok(BufferPlan {
        accessors,
        jobs,
        access_map,
        views,
        view_map,
        estimated_working_bytes: held.saturating_add(working.iter().copied().max().unwrap_or(0)),
        waves,
    })
}
