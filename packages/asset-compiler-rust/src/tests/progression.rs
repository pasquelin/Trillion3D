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
    assert_eq!(steps.last().expect("une fin").1, 1.0, "{steps:?}");
    fs::remove_dir_all(root).expect("nettoyage");
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
            .unwrap_or_else(|| panic!("phase {name} absente de {steps:?}"));
        assert!(
            *ratio > 0.95 && *ratio < 1.0,
            "la phase {name} annonce {ratio}"
        );
    }
    fs::remove_dir_all(root).expect("nettoyage");
}
