//! A14 — les mesures publiées décrivent un travail, et lui seul. Ce que ces épreuves tiennent :
//! aucune phase d'un travail ne reparaît dans le manifeste d'un autre, ni à la suite ni côte à côte,
//! et la durée annoncée contient tout ce que le travail a fait, purge comprise.
use super::*;
use std::time::Duration;

/// Les millisecondes cumulées d'une phase nommée, telles que le manifeste les publie.
fn phase(result: &Value, name: &str) -> f64 {
    result["metrics"]["phaseElapsedMs"][name]
        .as_f64()
        .unwrap_or_else(|| panic!("phase {name} absente de {}", result["metrics"]))
}
/// La plus longue des phases cumulées d'un travail, avec son nom.
fn longest_phase(result: &Value) -> (String, f64) {
    result["metrics"]["phaseElapsedMs"]
        .as_object()
        .expect("les phases")
        .iter()
        .map(|(name, ms)| (name.clone(), ms.as_f64().unwrap_or(0.0)))
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .expect("au moins une phase")
}
/// La grille qui simplifie : elle porte assez de groupes pour que la phase de simplification dure.
fn grid_that_simplifies() -> (PathBuf, Options) {
    let (root, mut options) = grid_fixture_displaced(64, 64, 3.0);
    options.simplification = "qem-endpoints".into();
    (root, options)
}
/// Attend qu'un jalon soit franchi, sans jamais attendre sans fin.
fn wait_for(flag: &AtomicBool) {
    let deadline = Instant::now() + Duration::from_secs(300);
    while !flag.load(Ordering::Relaxed) {
        assert!(Instant::now() < deadline, "jalon jamais franchi");
        std::thread::sleep(Duration::from_millis(2));
    }
}

// Comportement : deux travaux se suivent dans le même processus. Le second n'a aucun groupe à
// simplifier ; son manifeste doit donc annoncer zéro, et non la simplification de la grille d'avant.
#[test]
fn a14_un_travail_ne_publie_pas_les_phases_du_precedent() {
    let (root_grille, grille) = grid_that_simplifies();
    let premier = compile(&grille, |_| {}).expect("grille");
    assert!(
        phase(&premier, "simplifyMs") > 0.0,
        "la grille simplifie bien"
    );
    let (root_petit, petit) = fixture();
    let second = compile(&petit, |_| {}).expect("deux triangles");
    assert_eq!(
        phase(&second, "simplifyMs"),
        0.0,
        "deux triangles n'ont aucun groupe à simplifier"
    );
    let wall = second["metrics"]["wallMs"].as_f64().expect("wallMs");
    let (name, longest) = longest_phase(&second);
    assert!(
        wall >= longest,
        "durée annoncée {wall} ms sous la phase {name} de {longest} ms"
    );
    fs::remove_dir_all(root_grille).expect("nettoyage");
    fs::remove_dir_all(root_petit).expect("nettoyage");
}

// Comportement : les deux travaux se chevauchent. La grille retient sa publication le temps que le
// petit maillage compile entièrement à côté d'elle ; aucun des deux manifestes ne décrit l'autre.
#[test]
fn a14_deux_travaux_paralleles_ne_melangent_pas_leurs_phases() {
    let (root_grille, grille) = grid_that_simplifies();
    let (root_petit, petit) = fixture();
    let simplifie = AtomicBool::new(false);
    let petit_fini = AtomicBool::new(false);
    let (long, court) = std::thread::scope(|scope| {
        let long = scope.spawn(|| {
            compile(&grille, |event| {
                // Les paquets de racines s'assemblent une fois toutes les primitives groupées et
                // simplifiées : les compteurs de la grille sont pleins, et elle attend ici.
                if event["phase"] == "bootstrap" {
                    simplifie.store(true, Ordering::Relaxed);
                    wait_for(&petit_fini);
                }
            })
        });
        wait_for(&simplifie);
        let court = compile(&petit, |_| {}).expect("deux triangles");
        petit_fini.store(true, Ordering::Relaxed);
        (long.join().expect("fil").expect("grille"), court)
    });
    assert_eq!(
        phase(&court, "simplifyMs"),
        0.0,
        "le petit maillage ne simplifie rien, même pendant la grille"
    );
    assert!(
        phase(&long, "simplifyMs") > 0.0,
        "la grille garde sa propre simplification"
    );
    fs::remove_dir_all(root_grille).expect("nettoyage");
    fs::remove_dir_all(root_petit).expect("nettoyage");
}

// Comportement : la durée annoncée est prise après la purge, et non au moment où le manifeste est
// mis en forme. L'épreuve mesure elle-même l'intervalle entre l'import et la purge.
#[test]
fn a14_la_duree_annoncee_contient_la_publication_et_la_purge() {
    let (root, mut options) = grid_fixture_displaced(48, 48, 2.0);
    // Une première clé dans le cache, sous un autre mode, donne du travail à la purge de la seconde.
    options.simplification = "none".into();
    compile(&options, |_| {}).expect("première");
    options.simplification = "qem-endpoints".into();
    let marks: std::sync::Mutex<(Option<Instant>, Option<Instant>)> =
        std::sync::Mutex::new((None, None));
    let result = compile(&options, |event| {
        let mut marks = marks.lock().expect("jalons");
        match event["phase"].as_str() {
            Some("import") => marks.0 = Some(Instant::now()),
            Some("prune") => marks.1 = Some(Instant::now()),
            _ => {}
        }
    })
    .expect("seconde");
    let (import_evt, prune_evt) = marks.into_inner().expect("jalons");
    let observed = prune_evt.expect("la purge a bien eu lieu") - import_evt.expect("import");
    let import_ms = result["metrics"]["importMs"].as_f64().expect("importMs");
    let wall = result["metrics"]["wallMs"].as_f64().expect("wallMs");
    let floor = import_ms + observed.as_secs_f64() * 1000.0;
    assert!(
        wall >= floor,
        "durée annoncée {wall} ms sous le plancher observé {floor} ms"
    );
    fs::remove_dir_all(root).expect("nettoyage");
}

// Constat V03 : ces durées sont du temps écoulé, jamais du temps de processeur. L'épreuve le montre
// et le fixe : une attente franche tenue dans le rappel d'un jalon de la phase coplanaire s'ajoute à
// cette phase, alors qu'aucun processeur n'a travaillé pendant ce temps. Le nom publié dit donc
// « écoulé », et `cpuMs` reste `null` tant que personne ne le mesure vraiment.
#[test]
fn v03_une_attente_dans_un_rappel_entre_dans_la_duree_ecoulee_de_la_phase() {
    let (root, options) = fixture();
    let attente = Duration::from_millis(250);
    let result = compile(&options, |event| {
        if event["phase"] == "coplanar" && event["step"] == "done" {
            std::thread::sleep(attente);
        }
    })
    .expect("compilation");
    let coplanar = phase(&result, "coplanarMs");
    assert!(
        coplanar >= attente.as_secs_f64() * 1000.0,
        "l'attente du rappel n'entre pas dans la phase : {coplanar} ms"
    );
    assert!(
        result["metrics"]["cpuMs"].is_null(),
        "le temps de processeur n'est pas mesuré, il reste nul"
    );
    fs::remove_dir_all(root).expect("nettoyage");
}
