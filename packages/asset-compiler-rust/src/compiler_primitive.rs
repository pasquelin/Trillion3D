use super::*;
use crate::compiler_primitive_warn::primitive_event;
pub(crate) mod cost;
pub(crate) mod triangles;
pub(super) struct PrimitiveInputs<'a> {
    pub o: &'a Options,
    pub g: &'a Value,
    pub bin: &'a [u8],
    pub mesh_values: &'a [Value],
    pub mesh_map: &'a BTreeMap<usize, usize>,
    /// Largest world scale under which each source mesh is placed: it is what
    /// brings the proxy threshold, expressed in metres, into the primitive's
    /// object space.
    pub mesh_scales: &'a BTreeMap<usize, f64>,
    /// Triangles of the whole scene, every instance placed: the denominator of budget shares.
    pub scene_triangles: usize,
    /// Accessors that `plan_buffers` has already validated once, on the same bytes.
    pub validated: &'a BTreeSet<usize>,
    pub progress: &'a (dyn Fn(Value) + Sync),
}
/// A compiled primitive and what later stages read beside it once every primitive is done.
pub(super) struct CompiledPrimitive {
    pub value: Value,
    pub cluster_planes: Vec<Option<crate::coplanar::ClusterPlane>>,
    /// The resident proxy's coarse cut, in object space, and the threshold in metres it requested.
    pub proxy_cut: Vec<f32>,
    pub proxy_threshold: f64,
    pub collision: Value,
    pub source_cover: crate::compiler_world_roots::SourceCover,
    /// The groups its far field may draw as voxels.
    pub voxel_seed: crate::voxel::VoxelSeed,
    /// The run of its pages' bytes, which the geometry containers take (`compiler_geometry_files.rs`).
    pub page_run: Option<PageRun>,
}
/// Whether the engine draws `material` blended, sorted back to front and never merged with another
/// surface: `alphaMode` `BLEND` once the cutout decisions have rewritten the scene
/// (`cutout::apply_decisions`), or a transmission, whatever its mode (`transmissive_material`). The one
/// test of a primitive's `pass`.
pub(crate) fn drawn_blended(material: Option<&Value>) -> bool {
    transmissive_material(material)
        || material.is_some_and(|m| AlphaMode::of(m) == AlphaMode::Blend)
}
/// Whether primitive `p` draws triangles (`mode` 4, the default).
fn triangle_mode(p: &Value) -> Result<bool> {
    Ok(optional_index(p.get("mode"), "primitive.mode", 4)? == 4)
}
/// The material primitive `p` names, if any.
fn primitive_material<'g>(g: &'g Value, p: &Value) -> Result<Option<&'g Value>> {
    match p.get("material") {
        Some(material) => {
            Ok(values(g, "materials")?.get(required_index(Some(material), "primitive.material")?))
        }
        None => Ok(None),
    }
}
/// `compile_primitive` of one planned `(mesh, primitive)` job, its error naming the job.
pub(super) fn compile_job(
    inputs: &PrimitiveInputs<'_>,
    &(m, p): &(usize, usize),
) -> Result<CompiledPrimitive> {
    compile_primitive(inputs, &m, &p).map_err(|e| e.within(m, p))
}
pub(super) fn compile_primitive(
    inputs: &PrimitiveInputs<'_>,
    old: &usize,
    primitive: &usize,
) -> Result<CompiledPrimitive> {
    let PrimitiveInputs {
        o,
        g,
        bin,
        mesh_values,
        mesh_map,
        mesh_scales,
        scene_triangles,
        validated,
        progress,
        ..
    } = inputs;
    check(o)?;
    let p = item(
        values(item(mesh_values, *old, "mesh")?, "primitives")?,
        *primitive,
        "primitive",
    )?;
    if !triangle_mode(p)? {
        return Err(CompilerError::new(
            "UNSUPPORTED_PRIMITIVE",
            "Only static triangles are supported",
        ));
    }
    let (positions, index_values, triangle_count) = triangles::read(g, bin, p, Some(validated))?;
    let pos = {
        let _t = perf::Timer::new(perf::Phase::Decode);
        positions.collect_f32()?
    };
    let material = primitive_material(g, p)?;
    // Skin and morph pages share the GPU deformation stage before cut/raster.
    let blended = drawn_blended(material);
    let mesh = *mesh_map
        .get(old)
        .ok_or_else(|| invalid("Missing mesh mapping"))?;
    let attributes = compiler_page_record::page_attributes(g, bin, p, positions.count, validated)?;
    let mut deformation =
        compiler_page_record::page_deformation(g, bin, p, positions.count, validated)?;
    geometry_page_deform::declare_soft(&mut deformation, g, *old, &pos)?;
    let carried = carried_attributes(&attributes, material);
    let uv_exponent = geometry_page_quant::primitive_uv_exponent(&carried, blended);
    let encode = |slice: &[u32], pos: &[f32], carried: &[&_], origin: &[u32], exponent: i32| {
        let exponents = (exponent, uv_exponent);
        compiler_page_record::encode_page(slice, (pos, carried), (&deformation, origin), exponents)
    };
    // Every primitive joins the DAG, a blended one too, transmissive or not: its draw order is
    // restored at runtime from the recorded source rank, so spatial clustering does not scramble
    // the blend order, and the water pass composes its pages over the backdrop as any.
    let scale = mesh_scales.get(old).copied();
    let demand = crate::proxy::cut::cut_demand(
        scale,
        trillion3d_page_codec::proxy::PROXY_TRIANGLE_BUDGET,
        triangle_count,
        *scene_triangles,
    );
    let DagResult {
        pages,
        cluster_planes,
        proxy_cut,
        proxy_threshold,
        page_run,
        dag_report,
        timings,
        warnings,
        culling_report,
        structure_report,
        position_exponent,
        collision,
        source_cover,
        voxel_seed,
    } = build_dag_primitive(
        o,
        &pos,
        &carried,
        &index_values,
        demand,
        blended,
        crate::voxel::ShapePreservation::of(item(mesh_values, *old, "mesh")?),
        (trillion3d_page_codec::bits::grid::tile_log2(scale), scale),
        &encode,
    )?;
    let event = primitive_event(mesh, *primitive, pages.len(), timings, warnings);
    progress(event);
    let quantization =
        compiler_page_record::quantization_report(&pages, position_exponent, uv_exponent);
    let reach = geometry_page_deform::reach(&deformation, &pos);
    Ok(CompiledPrimitive {
        page_run,
        cluster_planes,
        proxy_cut,
        collision,
        source_cover,
        voxel_seed,
        proxy_threshold: proxy_threshold * scale.unwrap_or(1.0), // back in metres for the report
        value: json!({"mesh":mesh,"primitive":primitive,"material":p.get("material").cloned().unwrap_or(Value::Null),"triangles":triangle_count,"pass":if blended {"clustered-blend"} else {"exact-clusters"},"clusterStrategy":DAG_CLUSTER_STRATEGY,"dag":dag_report,"culling":culling_report,"structure":structure_report,"pages":pages,"quantization":quantization,"deformation":reach}),
    })
}
