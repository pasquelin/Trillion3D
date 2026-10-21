use crate::*;

mod view_refs;
pub(crate) use view_refs::{for_each_view_ref, remap_view_refs};

pub(crate) struct BufferPlan {
    pub accessors: BTreeSet<usize>,
    pub jobs: Vec<(usize, usize)>,
    pub access_map: BTreeMap<usize, usize>,
    pub views: BTreeSet<usize>,
    pub view_map: BTreeMap<usize, usize>,
    pub estimated_working_bytes: usize,
    /// The workers the job runs: its threads, as many as the budget holds beside the rest, one at least.
    pub threads: usize,
    /// Each of `jobs`' working set, and the room they share (`budget/admission.rs`).
    pub working: Vec<usize>,
    pub room: usize,
}

/// Bytes an accessor will occupy once decoded into a dense array: `count` elements
/// of `components` four-byte values. An accessor without a `bufferView`, or whose
/// sparse carries only a few values, expands the same way: that expansion is what
/// an allocation will request, never the stored bytes, and it alone can overflow
/// an integer.
fn dense_bytes(acc: &Value) -> Result<usize> {
    let (columns, rows) = acc
        .get("type")
        .and_then(Value::as_str)
        .and_then(crate::compiler::accessor::codes::element_shape)
        .ok_or_else(|| invalid("Unsupported accessor type"))?;
    let components = columns * rows;
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
    for a in attributes(p)?.values() {
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

pub(crate) fn plan_buffers(
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
        super::accessor::layout::validate(g, bin, *id)?;
    }
    let mut views = BTreeSet::new();
    let mut decoded_bytes = 0usize;
    for a in &accessors {
        let acc = item(accessor_values, *a, "accessor")?;
        decoded_bytes = decoded_bytes
            .checked_add(dense_bytes(acc)?)
            .ok_or_else(|| invalid("Working set overflow"))?;
        for_each_view_ref(acc, "accessor.bufferView", |view| {
            views.insert(view);
        })?;
    }
    for image in g
        .get("images")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        for_each_view_ref(image, "image.bufferView", |view| {
            views.insert(view);
        })?;
    }
    let view_map: BTreeMap<usize, usize> = views
        .iter()
        .enumerate()
        .map(|(new, old)| (*old, new))
        .collect();
    let mut committed = source_len.saturating_mul(2);
    for id in &views {
        committed = committed
            .checked_add(required_index(
                item(view_values, *id, "bufferView")?.get("byteLength"),
                "bufferView.byteLength",
            )?)
            .ok_or_else(|| invalid("Working set overflow"))?;
    }
    // Index buffers alone can refuse a job (no order lowers them); the rest only lowers how many
    // run at once.
    let (mut retained, mut working) = (0usize, Vec::with_capacity(jobs.len()));
    for (old, primitive) in &jobs {
        let p = item(
            values(item(mesh_values, *old, "mesh")?, "primitives")?,
            *primitive,
            "primitive",
        )?;
        let cost = super::primitive::cost::of(g, p).map_err(|e| e.within(*old, *primitive))?;
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
    // The job's threads are a bound: it runs as many workers as the budget holds beside the rest, one
    // at least, so a thread count never refuses a job one worker would compile.
    let worker = super::primitive::cost::WORKER_BYTES;
    let threads = o
        .threads
        .min(o.ram_budget_bytes().saturating_sub(committed) / worker)
        .max(1);
    committed = committed.saturating_add(threads.saturating_mul(worker));
    if committed > o.ram_budget_bytes() {
        return Err(CompilerError::new(
            "RAM_ADMISSION_BUDGET_EXCEEDED",
            "Estimated working set exceeds configured budget",
        ));
    }
    let held = committed.saturating_add(retained); // what is left is the primitives' room
    let room = o.ram_budget_bytes().saturating_sub(held);
    Ok(BufferPlan {
        accessors,
        jobs,
        access_map,
        views,
        view_map,
        estimated_working_bytes: held.saturating_add(working.iter().copied().max().unwrap_or(0)),
        threads,
        working,
        room,
    })
}
