//! A14 — published measurements describe single job. Tests verify:
//! no job phase reappears in another manifest, sequentially or in parallel,
//! announced duration contains everything job performed, purge included.
use super::*;
use std::time::Duration;

/// Cumulative milliseconds of named phase, as manifest publishes.
fn phase(result: &Value, name: &str) -> f64 {
    result["metrics"]["phaseElapsedMs"][name]
        .as_f64()
        .unwrap_or_else(|| panic!("phase {name} missing from {}", result["metrics"]))
}
/// Longest cumulative phase of job, with name.
fn longest_phase(result: &Value) -> (String, f64) {
    result["metrics"]["phaseElapsedMs"]
        .as_object()
        .expect("the phases")
        .iter()
        .map(|(name, ms)| (name.clone(), ms.as_f64().unwrap_or(0.0)))
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .expect("at least one phase")
}
/// Simplifying grid: carries enough groups for simplification phase to take time.
fn grid_that_simplifies() -> (PathBuf, Options) {
    let (root, mut options) = grid_fixture_displaced(64, 64, 3.0);
    options.simplification = "qem-endpoints".into();
    (root, options)
}
/// Waits for milestone to cross, never waiting endlessly.
fn wait_for(flag: &AtomicBool) {
    let deadline = Instant::now() + Duration::from_secs(300);
    while !flag.load(Ordering::Relaxed) {
        assert!(Instant::now() < deadline, "milestone never crossed");
        std::thread::sleep(Duration::from_millis(2));
    }
}

// Behavior: two jobs follow in same process. Second has no group to
// simplify; manifest must announce zero, not prior grid simplification.
#[test]
fn a14_un_travail_ne_publie_pas_les_phases_du_precedent() {
    let (root_grille, grille) = grid_that_simplifies();
    let premier = compile(&grille, |_| {}).expect("grille");
    assert!(
        phase(&premier, "simplifyMs") > 0.0,
        "the grid does simplify"
    );
    let (root_petit, petit) = fixture();
    let second = compile(&petit, |_| {}).expect("deux triangles");
    assert_eq!(
        phase(&second, "simplifyMs"),
        0.0,
        "two triangles have no group to simplify"
    );
    let wall = second["metrics"]["wallMs"].as_f64().expect("wallMs");
    let (name, longest) = longest_phase(&second);
    assert!(
        wall >= longest,
        "announced duration {wall} ms under phase {name} of {longest} ms"
    );
    fs::remove_dir_all(root_grille).expect("cleanup");
    fs::remove_dir_all(root_petit).expect("cleanup");
}

// Behavior: jobs overlap. Grid holds publication while
// small mesh compiles alongside; neither manifest describes other.
#[test]
fn a14_deux_travaux_paralleles_ne_melangent_pas_leurs_phases() {
    let (root_grille, grille) = grid_that_simplifies();
    let (root_petit, petit) = fixture();
    let simplifie = AtomicBool::new(false);
    let petit_fini = AtomicBool::new(false);
    let (long, court) = std::thread::scope(|scope| {
        let long = scope.spawn(|| {
            compile(&grille, |event| {
                // Root bundles assemble once all primitives grouped and
                // simplified: grid counters full, waiting here.
                if event["phase"] == "bootstrap" {
                    simplifie.store(true, Ordering::Relaxed);
                    wait_for(&petit_fini);
                }
            })
        });
        wait_for(&simplifie);
        let court = compile(&petit, |_| {}).expect("two triangles");
        petit_fini.store(true, Ordering::Relaxed);
        (long.join().expect("thread").expect("grid"), court)
    });
    assert_eq!(
        phase(&court, "simplifyMs"),
        0.0,
        "the small mesh simplifies nothing, even during the grid"
    );
    assert!(
        phase(&long, "simplifyMs") > 0.0,
        "the grid keeps its own simplification"
    );
    fs::remove_dir_all(root_grille).expect("cleanup");
    fs::remove_dir_all(root_petit).expect("cleanup");
}

// Behavior: announced duration taken after purge, not when manifest
// formatted. Test measures interval between import and purge.
#[test]
fn a14_la_duree_annoncee_contient_la_publication_et_la_purge() {
    let (root, mut options) = grid_fixture_displaced(48, 48, 2.0);
    // First cache key in other mode gives work to second purge.
    options.simplification = "none".into();
    compile(&options, |_| {}).expect("first");
    options.simplification = "qem-endpoints".into();
    let marks: std::sync::Mutex<(Option<Instant>, Option<Instant>)> =
        std::sync::Mutex::new((None, None));
    let result = compile(&options, |event| {
        let mut marks = marks.lock().expect("milestones");
        match event["phase"].as_str() {
            Some("import") => marks.0 = Some(Instant::now()),
            Some("prune") => marks.1 = Some(Instant::now()),
            _ => {}
        }
    })
    .expect("second");
    let (import_evt, prune_evt) = marks.into_inner().expect("milestones");
    let observed = prune_evt.expect("prune did happen") - import_evt.expect("import");
    let import_ms = result["metrics"]["importMs"].as_f64().expect("importMs");
    let wall = result["metrics"]["wallMs"].as_f64().expect("wallMs");
    let floor = import_ms + observed.as_secs_f64() * 1000.0;
    assert!(
        wall >= floor,
        "announced duration {wall} ms under the observed floor {floor} ms"
    );
    fs::remove_dir_all(root).expect("cleanup");
}

// Finding V03: durations are wall time, never CPU time. Test demonstrates:
// explicit wait in coplanar phase milestone callback adds to
// phase, while no CPU worked. Published name says "wall",
// `cpuMs` remains `null` until actually measured.
#[test]
fn v03_une_attente_dans_un_rappel_entre_dans_la_duree_ecoulee_de_la_phase() {
    let (root, options) = fixture();
    let wait_time = Duration::from_millis(250);
    let result = compile(&options, |event| {
        if event["phase"] == "coplanar" && event["step"] == "done" {
            std::thread::sleep(wait_time);
        }
    })
    .expect("compilation");
    let coplanar = phase(&result, "coplanarMs");
    assert!(
        coplanar >= wait_time.as_secs_f64() * 1000.0,
        "callback wait does not enter phase: {coplanar} ms"
    );
    assert!(
        result["metrics"]["cpuMs"].is_null(),
        "CPU time is not measured, it stays null"
    );
    fs::remove_dir_all(root).expect("cleanup");
}
