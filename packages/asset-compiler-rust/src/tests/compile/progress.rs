//! A17 — announced progress of a job never goes backwards. A host draws a bar
//! with this one number: a phase missing from the table used to send it back to
//! zero after ninety-nine percent, and the job looked like it was restarting.
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
fn a17_l_avancement_d_une_compilation_ne_recule_jamais() {
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

// Behaviour: the resident proxy and lights are known phases, placed between
// coplanar cuts and prune — not unknowns brought back to zero.
#[test]
fn a17_le_proxy_et_les_lampes_sont_des_phases_connues() {
    let (root, options) = grid_fixture_displaced(24, 24, 1.0);
    let steps = ratios(&options);
    for name in ["proxy", "lights"] {
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
