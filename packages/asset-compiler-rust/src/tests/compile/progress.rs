//! Announced progress of a job never goes backwards. A host draws a bar
//! with this one number: a phase missing from the table would send it back to
//! zero after ninety-nine percent, and the job looked like it was restarting. What a primitive's
//! event tells of the instances of an assembly its carrier left out is read here too.
use super::*;

/// Sequence of (phase, progress) pairs of a whole compilation.
fn ratios(options: &Options) -> Vec<(String, f64)> {
    let seen = std::sync::Mutex::new(Vec::new());
    compile(options, |event| {
        let phase = event["phase"].as_str().unwrap_or("?").to_string();
        let ratio = event["ratio"]
            .as_f64()
            .expect("every event carries a ratio");
        seen.lock().expect("avancement").push((phase, ratio));
    })
    .expect("compile");
    seen.into_inner().expect("avancement")
}

// Behaviour: on a complete compilation, progress grows without ever going down
// and finishes exactly at one.
#[test]
fn a17_a_compilation_progress_never_goes_back() {
    let (root, options) = grid_fixture_displaced(24, 24, 1.0);
    let steps = ratios(&options);
    let mut previous = 0.0;
    for (phase, ratio) in &steps {
        assert!(
            *ratio >= previous,
            "phase {phase} announces {ratio} after {previous}: {steps:?}"
        );
        previous = *ratio;
    }
    assert_eq!(steps.last().expect("an end").1, 1.0, "{steps:?}");
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: the lights are a known phase, placed between coplanar cuts and prune — not an
// unknown brought back to zero.
#[test]
fn a17_lamps_are_a_known_phase() {
    let (root, options) = grid_fixture_displaced(24, 24, 1.0);
    let steps = ratios(&options);
    for name in ["lights"] {
        let (_, ratio) = steps
            .iter()
            .find(|(phase, _)| phase == name)
            .unwrap_or_else(|| panic!("phase {name} missing from {steps:?}"));
        assert!(
            *ratio > 0.95 && *ratio < 1.0,
            "phase {name} announces {ratio}"
        );
    }
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a proven folder is a known phase at 0.98, and the bar still ends
// at one without going back — no clustering phase came before it.
#[test]
fn a_reused_folder_is_a_known_phase_and_the_bar_still_ends_at_one() {
    let (root, options) = grid_fixture_displaced(24, 24, 1.0);
    ratios(&options);
    let steps = ratios(&options);
    let (_, ratio) = steps
        .iter()
        .find(|(phase, _)| phase == "reuse")
        .unwrap_or_else(|| panic!("phase reuse missing from {steps:?}"));
    assert_eq!(*ratio, 0.98, "{steps:?}");
    assert!(
        steps.iter().all(|(phase, _)| phase != "primitive"),
        "no clustering on a reuse: {steps:?}"
    );
    assert!(
        steps.windows(2).all(|pair| pair[0].1 <= pair[1].1),
        "{steps:?}"
    );
    assert_eq!(steps.last().expect("an end").1, 1.0, "{steps:?}");
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: every event carries the process peak resident bytes, never decreasing, and the
// manifest publishes the peak its compilation reached.
#[cfg(unix)]
#[test]
fn every_event_carries_the_process_peak_rss() {
    let (root, options) = grid_fixture_displaced(24, 24, 1.0);
    let peaks = std::sync::Mutex::new(Vec::new());
    let result = compile(&options, |event| {
        let peak = event["peakRssBytes"]
            .as_u64()
            .expect("a peak on every event");
        peaks.lock().expect("peaks").push(peak);
    })
    .expect("compile");
    let peaks = peaks.into_inner().expect("peaks");
    assert!(peaks.windows(2).all(|pair| pair[0] <= pair[1]), "{peaks:?}");
    let published = result["metrics"]["peakRssBytes"]
        .as_u64()
        .expect("published");
    assert!(published > 0 && published <= *peaks.last().expect("events"));
    fs::remove_dir_all(root).expect("cleanup");
}

/// A facade of three windows laid out as an assembly (`allowAssemblies`) over a plain triangle.
/// The facade turns off the rebuilding of normals its windows keep by default, so that its levels
/// cannot carry what its windows' roots do. A window takes the material slot of the facade's
/// triangle (`part_meshes`), so the two differ by their attributes alone. With `shared_key` the
/// facade's triangle has the windows' (none), and carries the levels above them; else it has
/// normals of its own, the windows have none to share, and the load adds a placeholder to carry
/// them, which none of the windows can join.
fn assembly_scene(tag: &str, shared_key: bool) -> (std::path::PathBuf, Options) {
    let mut bin = triangle_bin();
    let mut own = json!({"attributes": {"POSITION": 0}, "indices": 1});
    if !shared_key {
        bin.extend(
            [0.0f32, 0.0, 1.0]
                .repeat(3)
                .iter()
                .flat_map(|v| v.to_le_bytes()),
        );
        own["attributes"]["NORMAL"] = json!(2);
    }
    let nodes: Vec<Value> = (0..3)
        .map(|k| json!({"part": 0, "translation": [3.0 * f64::from(k), 0.0, 0.0]}))
        .collect();
    let extras =
        json!({"recomputeNormals": false, "assembly": {"parts": [{"mesh": 0}], "nodes": nodes}});
    let buffer = json!({"uri": format!("{tag}.bin"), "byteLength": bin.len()});
    let mut gltf = triangle_gltf(buffer, json!([{"mesh": 1, "name": "Facade"}]));
    if !shared_key {
        let view = json!({"buffer": 0, "byteOffset": 48, "byteLength": 36});
        gltf["bufferViews"]
            .as_array_mut()
            .expect("views")
            .push(view);
        let normals = json!({"bufferView": 2, "componentType": 5126, "type": "VEC3", "count": 3});
        gltf["accessors"]
            .as_array_mut()
            .expect("accessors")
            .push(normals);
    }
    gltf["meshes"] = json!([
        {"name": "Window", "primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]},
        {"name": "Facade", "primitives": [own], "extras": extras},
    ]);
    gltf["scenes"] = json!([{"nodes": [0]}]);
    let (root, options) = gltf_fixture(tag, &gltf, &bin);
    let allowed = json!({"allowAssemblies": true});
    let mesh_build = crate::MeshBuildOptions::read(Some(&allowed));
    (
        root,
        Options {
            mesh_build,
            ..options
        },
    )
}

/// The compile of `options`: its result and every event it announced.
fn announced(options: &Options) -> (Value, Vec<Value>) {
    let events = std::sync::Mutex::new(Vec::new());
    let result = compile(options, |event| events.lock().expect("events").push(event));
    (
        result.expect("compile"),
        events.into_inner().expect("events"),
    )
}

/// The instances left out of the climb, as a primitive tells them.
fn left_out(instances: usize) -> Value {
    json!({"code": "assembly-group-not-merged", "instances": instances})
}

// Behaviour: a carrier the load added that none of the windows can join has nothing to climb over
// and no triangle of its own: the compile builds no job for it — it is none of the primitives
// compiled, and no page nor collider of it exists — and tells the instances it left out on its
// progress event.
#[test]
fn a_placeholder_no_instance_can_join_builds_no_job_and_is_told() {
    let (root, options) = assembly_scene("vacant", false);
    let (result, events) = announced(&options);
    let ranks = (result["primitives"].as_array().expect("primitives").iter())
        .map(|p| {
            (
                p["mesh"].as_u64().unwrap_or(99),
                p["primitive"].as_u64().unwrap_or(99),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        ranks,
        [(0, 0), (1, 0)],
        "the window and the facade's own triangle alone"
    );
    let told = (events.iter())
        .find(|e| e["phase"] == "primitive" && e["mesh"] == 1 && e["primitive"] == 1)
        .expect("the placeholder's event");
    assert_eq!(told["warnings"], json!([left_out(3)]));
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a carrier that has triangles of its own keeps them whatever joins it, and tells the
// instances it left out in the report of its DAG, which a warm run replays, as on its event.
#[test]
fn a_carrier_with_triangles_of_its_own_tells_the_instances_it_left_out_in_its_report() {
    let (root, options) = assembly_scene("kept", true);
    let (result, events) = announced(&options);
    let facade = (result["primitives"].as_array().expect("primitives").iter())
        .find(|p| p["mesh"] == 1)
        .expect("the facade's own primitive");
    let reported = facade["dag"]["warnings"].as_array().expect("warnings");
    assert!(reported.contains(&left_out(3)), "{reported:?}");
    let told = (events.iter())
        .find(|e| e["phase"] == "primitive" && e["mesh"] == 1 && e["primitive"] == 0)
        .expect("its event");
    assert!(
        told["warnings"]
            .as_array()
            .is_some_and(|w| w.contains(&left_out(3))),
        "{told}"
    );
    // A warm run replays what the report holds.
    let (_, warm) = announced(&options);
    let replayed = (warm.iter())
        .find(|e| e["phase"] == "primitive" && e["mesh"] == 1)
        .expect("replayed");
    assert!(
        replayed["warnings"]
            .as_array()
            .is_some_and(|w| w.contains(&left_out(3))),
        "{replayed}"
    );
    fs::remove_dir_all(root).expect("cleanup");
}
