//! A17 — l'avancement annoncé d'un travail ne recule jamais. Un hôte dessine une barre avec ce
//! seul nombre : une phase absente de la table la renvoyait à zéro après quatre-vingt-dix-neuf pour
//! cent, et le travail paraissait recommencer.
use super::*;

/// La suite des couples (phase, avancement) d'une compilation entière.
fn ratios(options: &Options) -> Vec<(String, f64)> {
    let seen = std::sync::Mutex::new(Vec::new());
    compile(options, |event| {
        let phase = event["phase"].as_str().unwrap_or("?").to_string();
        let ratio = event["ratio"]
            .as_f64()
            .expect("chaque événement porte un ratio");
        seen.lock().expect("avancement").push((phase, ratio));
    })
    .expect("compile");
    seen.into_inner().expect("avancement")
}

// Comportement : sur une compilation complète, l'avancement croît sans jamais redescendre et finit
// exactement à un.
#[test]
fn a17_l_avancement_d_une_compilation_ne_recule_jamais() {
    let (root, options) = grid_fixture_displaced(24, 24, 1.0);
    let steps = ratios(&options);
    let mut previous = 0.0;
    for (phase, ratio) in &steps {
        assert!(
            *ratio >= previous,
            "la phase {phase} annonce {ratio} après {previous} : {steps:?}"
        );
        previous = *ratio;
    }
    assert_eq!(steps.last().expect("une fin").1, 1.0, "{steps:?}");
    fs::remove_dir_all(root).expect("nettoyage");
}

// Comportement : le proxy résident et les lampes sont des phases connues, placées entre les coupes
// coplanaires et la purge — et non des inconnues ramenées à zéro.
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
