//! Messages cross the program boundary with their public code: a host reading the events counts
//! an import's warnings by code and reads a failure's public id, level and page, without opening
//! a manifest (#1351).
mod common;
use common::{compiler, fixture, lines, run_ok};
use std::fs;

// Behaviour: an OBJ citing a material library that is not there compiles; the `import` event
// counts the missing library by its code, and the pointer carries the texture stage's reasons.
#[test]
fn the_import_event_counts_the_import_warnings_by_code() {
    let (root, obj, cache) = fixture("messages-import");
    let text = fs::read_to_string(&obj).expect("obj");
    fs::write(&obj, format!("mtllib absent.mtl\nusemtl Uni\n{text}")).expect("obj");
    let output = run_ok(&mut compiler(&obj, &cache));
    let events = lines(&String::from_utf8_lossy(&output.stderr));
    let import = events
        .iter()
        .find(|event| event["phase"] == "import")
        .expect("import event");
    assert_eq!(
        import["unsupported"]["material-library-missing"], 1,
        "{import}"
    );
    let pointer = &lines(&String::from_utf8_lossy(&output.stdout))[0];
    assert!(pointer["textureSkipped"].is_object(), "{pointer}");
    fs::remove_dir_all(root).ok();
}

// Behaviour: a folder reused on a warm run tells the same warnings as the compile that wrote it —
// the import report, each flagged primitive and the lights left out — so a host counting them
// (`trillion3d-compile --strict`) decides the same warm as cold.
#[test]
fn a_reused_folder_tells_its_warnings_again() {
    let (root, obj, cache) = fixture("messages-reuse");
    let text = fs::read_to_string(&obj).expect("obj");
    fs::write(&obj, format!("mtllib absent.mtl\nusemtl Uni\n{text}")).expect("obj");
    let told = |events: &[serde_json::Value]| {
        let of = |phase: &str| {
            events
                .iter()
                .filter(|event| event["phase"] == phase)
                .map(|event| {
                    let mut kept = event.clone();
                    [
                        "ratio",
                        "peakRssBytes",
                        "ms",
                        "primitives",
                        "nodes",
                        "sharedMeshNodes",
                    ]
                    .iter()
                    .for_each(|field| {
                        kept.as_object_mut().map(|o| o.remove(*field));
                    });
                    kept
                })
                .collect::<Vec<_>>()
        };
        let primitives: Vec<_> = of("primitive")
            .into_iter()
            .filter(|event| event.get("warnings").is_some())
            .map(|event| event["warnings"].clone())
            .collect();
        let import: Vec<_> = of("import")
            .into_iter()
            .map(|e| e["unsupported"].clone())
            .collect();
        let lights: Vec<_> = of("lights")
            .into_iter()
            .map(|e| (e["rejected"].clone(), e["counts"].clone()))
            .collect();
        (import, primitives, lights)
    };
    let cold = run_ok(&mut compiler(&obj, &cache));
    let warm = run_ok(&mut compiler(&obj, &cache));
    let cold = lines(&String::from_utf8_lossy(&cold.stderr));
    let warm = lines(&String::from_utf8_lossy(&warm.stderr));
    assert!(
        warm.iter()
            .any(|e| e["phase"] == "reuse" && e["completed"] == 1),
        "the warm run reuses the folder"
    );
    let (import, primitives, lights) = told(&warm);
    assert_eq!(import[0]["material-library-missing"], 1, "{warm:?}");
    assert_eq!((import, primitives, lights), told(&cold));
    fs::remove_dir_all(root).ok();
}

// Behaviour: a refused job's error event and stdout both carry the code's public id, its level,
// the action and the documentation page, beside the symbolic code the host already read.
#[test]
fn a_failure_carries_its_public_code() {
    let (root, _, cache) = fixture("messages-error");
    let output = compiler(&root.join("absent.obj"), &cache)
        .output()
        .expect("run");
    assert!(!output.status.success());
    let refusal = &lines(&String::from_utf8_lossy(&output.stdout))[0];
    let events = lines(&String::from_utf8_lossy(&output.stderr));
    let error = events
        .iter()
        .rfind(|event| event["event"] == "error")
        .expect("error event");
    for told in [refusal, error] {
        assert!(
            told["id"]
                .as_str()
                .is_some_and(|id| id.starts_with("T3D-E")),
            "{told}"
        );
        assert_eq!(told["level"], "error");
        assert!(
            told["action"].is_string() && told["cause"].is_string(),
            "{told}"
        );
    }
    fs::remove_dir_all(root).ok();
}
