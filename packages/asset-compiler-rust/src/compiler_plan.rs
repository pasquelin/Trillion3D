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

mod accessors;
mod lines;
use accessors::{dense_bytes, primitive_accessors};

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
            if !(1..=3).contains(&optional_index(p.get("mode"), "primitive.mode", 4)?) {
                jobs.push((*old, primitive));
            }
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
    lines::validate(o, g, bin, meshes)?;
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
