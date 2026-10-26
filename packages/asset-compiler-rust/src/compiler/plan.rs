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
    /// The most triangles a mesh that bakes a displacement may be tessellated to: what the room
    /// allows the primitives that bake (`bake_cap`).
    pub bake_cap: usize,
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

/// The refusal of a count too large to add up.
fn overflow() -> CompilerError {
    invalid("Working set overflow")
}

/// The rank of each of `set`'s members among them, in order.
fn ranks(set: &BTreeSet<usize>) -> BTreeMap<usize, usize> {
    set.iter()
        .enumerate()
        .map(|(new, old)| (*old, new))
        .collect()
}

/// The accessors the jobs read, and the jobs: `(mesh, primitive)` pairs.
type JobsOf = (BTreeSet<usize>, Vec<(usize, usize)>);

/// The jobs of `meshes` — one for each glTF primitive — and the accessors they read.
fn jobs_of(g: &Value, meshes: &BTreeSet<usize>) -> Result<JobsOf> {
    let mesh_values = values(g, "meshes")?;
    let (mut accessors, mut jobs) = (BTreeSet::new(), Vec::new());
    for old in meshes {
        for (primitive, p) in values(item(mesh_values, *old, "mesh")?, "primitives")?
            .iter()
            .enumerate()
        {
            primitive_accessors(p, &mut accessors).map_err(|e| e.within(*old, primitive))?;
            jobs.push((*old, primitive));
        }
    }
    Ok((accessors, jobs))
}

/// The accessors the skins' inverse bind matrices and the animations' samplers read.
fn scene_accessors(g: &Value, accessors: &mut BTreeSet<usize>) -> Result<()> {
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
    Ok(())
}

/// The buffer views the accessors and the images name, and the bytes the accessors decode to.
fn views_of(g: &Value, accessors: &BTreeSet<usize>) -> Result<(BTreeSet<usize>, usize)> {
    let accessor_values = values(g, "accessors")?;
    let mut views = BTreeSet::new();
    let mut decoded_bytes = 0usize;
    for a in accessors {
        let acc = item(accessor_values, *a, "accessor")?;
        decoded_bytes = (decoded_bytes.checked_add(dense_bytes(acc)?)).ok_or_else(overflow)?;
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
    Ok((views, decoded_bytes))
}

/// The bytes the buffer views `views` hold.
fn view_bytes(g: &Value, views: &BTreeSet<usize>) -> Result<usize> {
    let view_values = values(g, "bufferViews")?;
    let mut bytes = 0usize;
    for id in views {
        let length = item(view_values, *id, "bufferView")?.get("byteLength");
        let length = required_index(length, "bufferView.byteLength")?;
        bytes = bytes.checked_add(length).ok_or_else(overflow)?;
    }
    Ok(bytes)
}

/// What the jobs hold: the source index buffers of all, the pages' records that stay of the plain
/// ones, each job's working set, and the jobs that bake, whose working set and records wait for the
/// cap the rest leaves room for (`bake_costs`).
struct Costs {
    indices: usize,
    retained: usize,
    working: Vec<usize>,
    baking: Vec<usize>,
}

/// The costs of `jobs`, but for the primitives of the meshes that bake (`bakes`).
fn job_costs(
    g: &Value,
    jobs: &[(usize, usize)],
    bakes: &crate::displace::Bakes<'_>,
) -> Result<Costs> {
    let mesh_values = values(g, "meshes")?;
    let mut costs = Costs {
        indices: 0,
        retained: 0,
        working: Vec::with_capacity(jobs.len()),
        baking: Vec::new(),
    };
    for (at, (old, primitive)) in jobs.iter().enumerate() {
        let primitives = values(item(mesh_values, *old, "mesh")?, "primitives")?;
        let p = item(primitives, *primitive, "primitive")?;
        let cost = super::primitive::cost::of(g, p).map_err(|e| e.within(*old, *primitive))?;
        costs.indices = costs
            .indices
            .checked_add(cost.indices)
            .ok_or_else(overflow)?;
        if bakes.names(*old) {
            costs.baking.push(at);
            costs.working.push(0);
        } else {
            costs.retained = costs.retained.saturating_add(cost.retained);
            costs.working.push(cost.working);
        }
    }
    Ok(costs)
}

/// The jobs that bake charged, under the cap the room allows them: a quarter of what the budget
/// leaves (`free`) for the working set of one and a quarter for the records of all, the other half
/// kept for the textures' stages, which read the reservation too. Returns the cap, at which the
/// tessellation then stops (`PrimitiveInputs::bake_cap`).
fn bake_costs(
    g: &Value,
    (costs, jobs): (&mut Costs, &[(usize, usize)]),
    (bakes, maps): (&crate::displace::Bakes<'_>, &BTreeMap<usize, usize>),
    free: usize,
) -> Result<usize> {
    let cap = super::primitive::cost::bake_cap(free / 4, costs.baking.len());
    for &at in &costs.baking {
        let (old, _) = jobs[at];
        let (triangles, vertices) = super::primitive::cost::mesh_counts(g, old)?;
        let named = bakes.textures(old);
        let decoded = named.iter().filter_map(|texture| maps.get(texture));
        let decoded = decoded.copied().max().unwrap_or(0);
        let cost = super::primitive::cost::of_baked_counts(triangles, vertices, decoded, cap);
        let cost = cost.ok_or_else(overflow)?;
        costs.working[at] = cost.working;
        costs.retained = costs.retained.saturating_add(cost.retained);
    }
    Ok(cap)
}

pub(crate) fn plan_buffers(
    o: &Options,
    g: &Value,
    bin: &[u8],
    source_len: usize,
    (meshes, bakes): (&BTreeSet<usize>, &crate::displace::Bakes<'_>),
) -> Result<BufferPlan> {
    let (mut accessors, jobs) = jobs_of(g, meshes)?;
    scene_accessors(g, &mut accessors)?;
    for id in &accessors {
        super::accessor::layout::validate(g, bin, *id)?;
    }
    let (views, decoded_bytes) = views_of(g, &accessors)?;
    // The height maps the meshes bake with, each image once however many meshes name it, held once
    // read.
    let maps = bakes.texels()?;
    let held = super::primitive::cost::maps_bytes(maps.values().copied()).ok_or_else(overflow)?;
    let mut committed = source_len.saturating_mul(2).saturating_add(held);
    committed = committed
        .checked_add(view_bytes(g, &views)?)
        .ok_or_else(overflow)?;
    // Index buffers alone can refuse a job (no order lowers them); the rest only lowers how many
    // run at once.
    let mut costs = job_costs(g, &jobs, bakes)?;
    committed = (committed.checked_add(costs.indices))
        .and_then(|total| total.checked_add(bin.len()))
        .and_then(|total| total.checked_add(decoded_bytes))
        .ok_or_else(overflow)?;
    // The job's threads are a bound: it runs as many workers as the budget holds beside the rest, one
    // at least, so a thread count never refuses a job one worker would compile.
    let worker = super::primitive::cost::WORKER_BYTES;
    let budget = o.ram_budget_bytes();
    let threads = o
        .threads
        .min(budget.saturating_sub(committed) / worker)
        .max(1);
    committed = committed.saturating_add(threads.saturating_mul(worker));
    if committed > budget {
        return Err(CompilerError::new(
            "RAM_ADMISSION_BUDGET_EXCEEDED",
            "Estimated working set exceeds configured budget",
        ));
    }
    let free = budget.saturating_sub(committed.saturating_add(costs.retained));
    let bake_cap = bake_costs(g, (&mut costs, &jobs), (bakes, &maps), free)?;
    let held = committed.saturating_add(costs.retained); // what is left is the primitives' room
    let widest = costs.working.iter().copied().max().unwrap_or(0);
    Ok(BufferPlan {
        access_map: ranks(&accessors),
        view_map: ranks(&views),
        accessors,
        jobs,
        views,
        estimated_working_bytes: held.saturating_add(widest),
        threads,
        working: costs.working,
        room: budget.saturating_sub(held),
        bake_cap,
    })
}
