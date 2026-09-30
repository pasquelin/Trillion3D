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
            told["action"].is_string() && told["docs"].is_string(),
            "{told}"
        );
    }
    fs::remove_dir_all(root).ok();
}
