//! The compile stage: every drawn mesh judged, the eligible ones baked and stored, and the
//! report entry that names each mesh baked or refused, with its reason.
use super::bake::{bake, Capture};
use super::eligibility::{deforms, judge, masked, precheck, reference_focal};
use super::eligibility::{texel_depth, triangle_depth};
use super::eligibility::{Candidate, ATLAS_LIMIT, FRAMES, PROBE_SIDE};
use super::mesh::Traceable;
use crate::compiler_validate::values;
use crate::compiler_world::{transform_point, world_matrices, Mat4};
use crate::proxy::{bvh, primitives_by_mesh, stage_proxy, world_scale, ProxyInputs, SceneProxy};
use crate::shared_math::{length, linear_columns, sub};
use crate::{Options, Result};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

/// Report contract: the atlas layout, its maps and their chains. A change moves it.
pub(crate) const IMPOSTOR_VERSION: u32 = 1;

/// What the stage reads beyond the proxy's inputs: the job, the source binary, the skinned
/// source meshes.
pub(crate) type Job<'a> = (
    &'a rayon::ThreadPool,
    &'a Options,
    &'a [u8],
    &'a BTreeSet<usize>,
);

/// The two stand-ins of distant geometry, from the same inputs: the resident proxy for light
/// rays, then the impostors, judged against the proxy's world bounds — their diagonal is the
/// farthest a placement is seen from.
pub(crate) fn stage_stand_ins(
    (pool, o, bin, skinned): Job<'_>,
    scene: &ProxyInputs<'_>,
    progress: &(impl Fn(Value) + Sync),
) -> Result<(SceneProxy, Value)> {
    let proxy = {
        let _t = crate::perf::Timer::new(crate::perf::Phase::Manifest);
        stage_proxy(scene)?
    };
    progress(
        json!({"phase":"proxy","completed":1,"total":1,"triangles":proxy.triangle_count(),
        "nodes":proxy.node_count(),"errorMetres":proxy.error_metres}),
    );
    let impostors = {
        let _t = crate::perf::Timer::new(crate::perf::Phase::Impostors);
        pool.install(|| stage_impostors(o, bin, skinned, scene, proxy.bounds))?
    };
    progress(json!({"phase":"impostors","completed":1,"total":1,"baked":impostors["baked"]}));
    Ok((proxy, impostors))
}

/// Hemi-octahedral when no placement can be seen from below: each keeps the mesh's +Y up
/// and stands on the scene's floor, within one probe texel.
fn hemi(mesh: &Traceable, placements: &[Mat4], floor: f64) -> bool {
    let low = bvh::extent(&mesh.world.triangles)[1];
    placements.iter().all(|m| {
        let [x, y, z] = linear_columns(m);
        let upright = y[1] > 0.0
            && [x[1], y[0], y[2], z[1]]
                .iter()
                .all(|v| v.abs() <= 1e-9 * y[1]);
        let base = transform_point(m, [mesh.centre[0], low, mesh.centre[2]])[1];
        let texel = 2.0 * mesh.radius * world_scale(m) / PROBE_SIDE as f64;
        upright && base <= floor + texel
    })
}

/// What a mesh is loaded as, once its candidacy holds: the traceable mesh, the largest world
/// scale of its placements and whether it bakes hemi-octahedral.
pub(crate) type Loaded = (Traceable, f64, bool);

/// The report entry of one mesh, baking and storing its atlas when it is eligible. The mesh is
/// read (`load`) only once the checks that need no trace pass.
pub(crate) fn entry(
    o: &Options,
    mut candidate: Candidate,
    load: impl FnOnce() -> Result<Loaded>,
) -> Result<Value> {
    let facts = |c: &Candidate| {
        json!({"placements": c.placements, "masked": c.masked, "rootTriangles": c.root_triangles,
            "radius": c.radius})
    };
    if let Err(refusal) = precheck(&candidate) {
        return Ok(merge(refusal.json(&candidate, None), facts(&candidate)));
    }
    let (mesh, scale, hemi) = load()?;
    candidate.radius = mesh.radius * scale;
    let probe = Capture {
        frames: FRAMES,
        side: PROBE_SIDE,
        hemi,
    };
    let probe = (mesh.radius > 0.0).then(|| bake(&mesh, probe));
    let probed = probe.as_ref().map_or(0.0, |atlas| atlas.coverage());
    let side = match judge(&candidate, probed) {
        Ok(side) => side,
        Err(refusal) => {
            let entry = refusal.json(&candidate, Some(probed));
            return Ok(merge(entry, facts(&candidate)));
        }
    };
    // The smallest frame side is the probe's own: its atlas is the bake.
    let mut atlas = match probe {
        Some(atlas) if side == PROBE_SIDE => atlas,
        _ => bake(
            &mesh,
            Capture {
                side,
                frames: FRAMES,
                hemi,
            },
        ),
    };
    let coverage = atlas.coverage();
    atlas.dilate();
    let (maps, bytes) = atlas.store(o)?;
    let focal = reference_focal();
    Ok(merge(
        json!({"status": "baked", "coverage": coverage, "hemi": hemi, "frames": FRAMES,
            "frameSide": side, "atlasSide": atlas.side, "bytes": bytes, "maps": maps,
            "centre": mesh.centre, "objectRadius": mesh.radius,
            "switchDepth": {"texel": texel_depth(&candidate, side, focal),
                "triangles": triangle_depth(&candidate, coverage, focal)}}),
        facts(&candidate),
    ))
}

fn merge(mut entry: Value, facts: Value) -> Value {
    crate::compiler_primitive_stalls::merge(&mut entry, facts);
    entry
}

/// Judges every drawn mesh; returns the compile report's `impostors` section.
fn stage_impostors(
    o: &Options,
    bin: &[u8],
    skinned: &BTreeSet<usize>,
    inputs: &ProxyInputs<'_>,
    b: [f64; 6],
) -> Result<Value> {
    let world = world_matrices(inputs.g)?;
    let nodes = values(inputs.g, "nodes")?;
    let mut placed: BTreeMap<usize, Vec<Mat4>> = BTreeMap::new();
    for &node in inputs.shown {
        let mesh = nodes
            .get(node)
            .and_then(|n| n.get("mesh"))
            .and_then(Value::as_u64);
        if let Some(mesh) = mesh.filter(|m| inputs.mesh_map.contains_key(&(*m as usize))) {
            placed.entry(mesh as usize).or_default().push(world[node]);
        }
    }
    let reach = length(sub([b[3], b[4], b[5]], [b[0], b[1], b[2]]));
    let by_mesh = primitives_by_mesh(inputs.primitives);
    let mut meshes = Vec::with_capacity(placed.len());
    for (mesh, placements) in placed {
        let compiled = inputs.mesh_map[&mesh];
        let root_triangles = by_mesh.get(&(compiled as u64)).into_iter().flatten();
        let root_triangles = root_triangles
            .map(|&p| {
                inputs.primitives[p]["dag"]["rootTriangles"]
                    .as_u64()
                    .unwrap_or(0) as usize
            })
            .sum();
        let candidate = Candidate {
            root_triangles,
            radius: 0.0,
            placements: placements.len(),
            masked: masked(inputs.g, mesh),
            skinned: skinned.contains(&mesh) || deforms(inputs.g, mesh),
            reach,
        };
        let mut entry = entry(o, candidate, || {
            let traceable = Traceable::read(inputs.g, bin, mesh, inputs.previews)?;
            let scale = placements.iter().map(world_scale).fold(0.0, f64::max);
            let hemi = hemi(&traceable, &placements, b[1]);
            Ok((traceable, scale, hemi))
        })?;
        entry["mesh"] = json!(compiled);
        entry["sourceMesh"] = json!(mesh);
        entry["name"] = inputs.g["meshes"][mesh]["name"].clone();
        meshes.push(entry);
    }
    let count = |status: &str| meshes.iter().filter(|m| m["status"] == status).count();
    Ok(
        json!({"version": IMPOSTOR_VERSION, "frames": FRAMES, "focalPixels": reference_focal(),
        "textureLimit": ATLAS_LIMIT, "baked": count("baked"), "refused": count("refused"),
        "meshes": meshes}),
    )
}
