//! What the compiled scene references: the accessors and buffer views `source.gltf` keeps, and
//! their output ranks. Walked twice — once before compilation, to validate and admit the job,
//! once to lay `source.bin` out.
use super::*;

/// The accessors a scene references and the primitives to compile, `(mesh, primitive)` each.
pub(super) type ReferencedAccessors = (BTreeSet<usize>, Vec<(usize, usize)>);

/// The layout `source.gltf` and `source.bin` are written in.
pub(super) struct SourceLayout {
    pub accessors: BTreeSet<usize>,
    pub access_map: BTreeMap<usize, usize>,
    pub views: BTreeSet<usize>,
    pub view_map: BTreeMap<usize, usize>,
}
impl SourceLayout {
    /// Layout of the compiled scene: the views `accessors` read, each of the two in its
    /// output rank.
    pub(super) fn of(g: &Value, accessors: BTreeSet<usize>) -> Result<Self> {
        let views = referenced_views(g, &accessors)?;
        Ok(Self {
            access_map: rank_map(&accessors),
            view_map: rank_map(&views),
            accessors,
            views,
        })
    }
}

/// Accessors the compiled scene references, and the primitives to compile: every primitive of
/// the selected meshes, plus skins and animations.
pub(super) fn referenced_accessors(
    g: &Value,
    meshes: &BTreeSet<usize>,
) -> Result<ReferencedAccessors> {
    let mesh_values = values(g, "meshes")?;
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
    Ok((accessors, jobs))
}

/// Buffer views the accessors read, dense or sparse, plus those of embedded images.
pub(super) fn referenced_views(g: &Value, accessors: &BTreeSet<usize>) -> Result<BTreeSet<usize>> {
    let accessor_values = values(g, "accessors")?;
    let mut views = BTreeSet::new();
    for a in accessors {
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
    Ok(views)
}

/// Writes `source.bin` in the layout the plan settled on.
pub(super) fn write_source_bin(
    o: &Options,
    g: &Value,
    bin: &[u8],
    layout: &SourceLayout,
    directory: &Path,
) -> Result<(Vec<Value>, Product)> {
    let _t = perf::Timer::new(perf::Phase::PageWrite);
    copy_source_bin(o, bin, values(g, "bufferViews")?, &layout.views, directory)
}

/// Output rank of every member of a set, in its order.
pub(super) fn rank_map(set: &BTreeSet<usize>) -> BTreeMap<usize, usize> {
    set.iter()
        .enumerate()
        .map(|(new, old)| (*old, new))
        .collect()
}
