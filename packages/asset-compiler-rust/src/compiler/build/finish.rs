//! The end of a compiled job: its manifest written from every stage's report, published with its
//! products, then the cache pruned around it.
use super::products::Staged;
use super::*;
use crate::texture::TexturePreview;

/// The manifest of the job under `key`, published in `directory`, then the cache pruned: the
/// manifest returned, with the prune's and the whole job's times.
pub(super) fn finish_job(
    (o, key, directory): (&Options, &str, &Path),
    (staged, reports): (Staged, Reports),
    (primitives, geometry_files, texture_previews): (&[Value], &[Value], &[TexturePreview]),
    (selected_triangles, chosen, manifest): (usize, &BTreeSet<usize>, &Value),
    (phases, started, cluster_start, import_ms): (
        &crate::support::perf::JobPhases,
        Instant,
        Instant,
        f64,
    ),
    (bin, offset, threads, estimated_working_bytes, waited): Sizes<'_>,
    progress: &(impl Fn(Value) + Sync),
) -> Result<Value> {
    let (scene_plugin, coplanar_report, texture_preview_report, hair_strands) = reports;
    let Staged {
        voxels,
        distance_fields,
        mesh_cards,
        ray_tracing,
        volumetric_lightmap,
        sparse_volumes,
        products,
        paged,
        mut world_report,
        physics,
        animation_banks,
        world_previews: _,
    } = staged;
    let unsupported = crate::compiler::cache::format::unsupported(&o.simplification);
    let cache_format = crate::compiler::cache::format::cache_format(primitives);
    let mut metrics = json!({
        "importMs": import_ms, "clusterHierarchyPagesMs": shared_math::elapsed_ms(cluster_start),
        "compileMs": shared_math::elapsed_ms(started), "sourceMappedBytes": bin.len(),
        "outputGeometryBytes": offset, "phaseElapsedMs": phases.report(), "threads": threads,
        "ramBudgetMb": o.ram_budget_mb, "admissionEstimatedBytes": estimated_working_bytes,
        "compileWaited": waited, "peakRssBytes": crate::support::perf::rss::peak_bytes(),
        "cpuMs": null, "diskBytesRead": null,
    });
    // The world's own measures join the job's: run measures, never part of what it built.
    let world_metrics = world_report
        .as_object_mut()
        .and_then(|r| r.remove("metrics"));
    if let (Some(Value::Object(world)), Some(all)) = (world_metrics, metrics.as_object_mut()) {
        all.extend(world);
    }
    let mut result = json!({
        "formatVersion": cache_format, "compilerVersion": COMPILER_VERSION,
        "errorModel": DAG_ERROR_MODEL,
        "geometryPages": crate::compiler::pages::record::geometry_page_format(),
        "geometryFiles": geometry_files, "status": "ready", "key": key,
        "scenePlugin": scene_plugin, "scope": o.scope,
        "clusterStrategy": DAG_CLUSTER_STRATEGY, "coplanar": coplanar_report,
        "texturePreviews": texture_preview_report,
        "voxels": voxels,
        "physics": physics,
        "selectedTriangles": selected_triangles,
        "sourceTriangles": manifest["runtime"]["trianglesAcrossNodes"],
        "selectedNodes": chosen.len(), "totalNodes": manifest["runtime"]["meshNodes"],
        "worldRoots": world_report,
        "worstStalls": crate::compiler::primitive::stalls::worst_stalls(primitives),
        "primitives": primitives, "simplification": o.simplification != "none",
        "metrics": metrics, "unsupported": unsupported,
    });
    // Named only by a scene whose meshes build a distance field.
    if let Some(fields) = distance_fields {
        result["distanceFields"] = fields;
    }
    // Named only by a scene whose meshes keep some card.
    if let Some(cards) = mesh_cards {
        result["meshCards"] = cards;
    }
    // Named only by a scene some of whose primitives have a triangle in their cut.
    if let Some(tracing) = ray_tracing {
        result["rayTracing"] = tracing;
    }
    // Named only by a scene whose nodes carry curves.
    if let Some(strands) = hair_strands {
        result["hairStrands"] = strands;
    }
    // Named only by a job that baked a volumetric lightmap.
    if let Some(lightmap) = volumetric_lightmap {
        result["volumetricLightmap"] = lightmap;
    }
    // Named only by a scene whose nodes cite a `.vdb` volume.
    if let Some(volumes) = sparse_volumes {
        result["sparseVolumes"] = volumes;
    }
    // Named only by a scene whose objects play an item of the animation banks.
    if let Some(banks) = animation_banks {
        result["animationBanks"] = banks;
    }
    publish(
        &Publication {
            o,
            key,
            directory,
            cache_format,
            products: &products,
            previews: texture_previews,
            mesh_pages: &paged,
        },
        &result,
    )?;
    // Prune belongs to the job: the manifest carries `compileMs`, the caller `wallMs` after it.
    let prune_start = Instant::now();
    let keep = Keep::of_result(&result, texture_previews);
    let pruned = prune_cache(o, key, keep, progress)?;
    result["metrics"]["pruneMs"] = json!(shared_math::elapsed_ms(prune_start));
    result["metrics"]["wallMs"] = json!(shared_math::elapsed_ms(started));
    progress(json!({"phase":"complete","completed":1,"total":1,"pruned":pruned}));
    Ok(result)
}

/// What the stages report beside their products: the scene plugin's provenance, the coplanar and
/// the texture preview reports, and the hair strands' section.
type Reports = (Option<Value>, Value, Value, Option<Value>);

/// What the job's metrics weigh: the source binary, the geometry written, the workers, the
/// admitted working set and the primitives the room made wait (`budget/admission.rs`).
pub(super) type Sizes<'a> = (&'a [u8], usize, usize, usize, usize);
