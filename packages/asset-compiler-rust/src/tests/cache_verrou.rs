use super::*;

/// Cache consistency held regardless of outcome: published pointer names key whose
/// folder exists, and each page named by sidecar columns is still on
/// disk. Exactly what concurrent purge destroys.
fn assert_cache_coherent(cache: &Path, scope: &str) {
    let pointer = read_json(&cache.join("native").join(scope).join("manifest.json"));
    let key = pointer["key"].as_str().expect("clef du pointeur");
    let directory = cache.join("native").join(scope).join(key);
    assert!(
        directory.join("clusters.json").exists(),
        "le pointeur nomme {key}, dont le dossier a disparu"
    );
    let binary = fs::read(directory.join(MANIFEST_BINARY_FILE)).expect("sidecar");
    for digest in manifest_binary::digests(&binary).expect("colonnes du sidecar") {
        assert!(
            cache
                .join("native/objects")
                .join(format!("{digest}.bin"))
                .exists(),
            "la page {digest} que le manifeste nomme a disparu"
        );
    }
}

/// A02: two concurrent compilations of same cache. Cache keeps single pointer per scope
/// and purges after each write: without mutual exclusion, one purge erases key and
/// objects other just published. Each compilation must succeed or be refused,
/// cache remaining readable in both cases.
#[test]
fn a02_deux_fils_sur_un_meme_cache_laissent_un_pointeur_lisible() {
    for _ in 0..4 {
        let (first_root, first) = fixture();
        let (second_root, second) = cube_fixture();
        let first = Options {
            scope: "full".into(),
            triangle_budget: 150000,
            ..first
        };
        let second = Options {
            cache: first.cache.clone(),
            simplification: "none".into(),
            ..second
        };
        let outcomes = std::thread::scope(|scope| {
            let one = scope.spawn(|| compile(&first, |_| {}));
            let two = scope.spawn(|| compile(&second, |_| {}));
            [one.join().expect("fil"), two.join().expect("fil")]
        });
        for outcome in &outcomes {
            if let Err(error) = outcome {
                assert_eq!(error.code, "CACHE_LOCKED", "{error}");
            }
        }
        assert!(
            outcomes.iter().any(Result::is_ok),
            "au moins une compilation aboutit"
        );
        assert_cache_coherent(&first.cache, "full");
        fs::remove_dir_all(first_root).expect("cleanup");
        fs::remove_dir_all(second_root).expect("cleanup");
    }
}
