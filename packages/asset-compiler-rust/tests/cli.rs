//! End-to-end checks of the executable's protocol: events on stderr, pointer(s) on stdout, exit codes.
use serde_json::Value;
use std::{
    fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
};
fn fixture(tag: &str) -> (PathBuf, PathBuf, PathBuf) {
    let root =
        std::env::temp_dir().join(format!("web-geometry-cli-{}-{}", std::process::id(), tag));
    let source = root.join("source");
    let cache = root.join("cache");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&source).expect("source");
    fs::write(
        source.join("quad.obj"),
        "v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nvn 0 0 1\nf 1//1 2//1 4//1 3//1\n",
    )
    .expect("obj");
    (root, source.join("quad.obj"), cache)
}
fn lines(text: &str) -> Vec<Value> {
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).unwrap_or_else(|_| panic!("not JSON: {l}")))
        .collect()
}
#[test]
fn single_job_prints_a_pointer_and_streams_events() {
    let (root, obj, cache) = fixture("single");
    let output = Command::new(env!("CARGO_BIN_EXE_web-geometry-compiler"))
        .args([
            obj.to_str().unwrap(),
            cache.to_str().unwrap(),
            "full",
            "150000",
            "1",
            "64",
            "/assets/",
            "none",
        ])
        .stdin(Stdio::null())
        .output()
        .expect("run");
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = lines(&String::from_utf8_lossy(&output.stdout));
    assert_eq!(stdout.len(), 1);
    assert_eq!(stdout[0]["status"], "ready");
    assert_eq!(stdout[0]["selectedTriangles"], 2);
    assert!(
        stdout[0]
            .get("primitives")
            .map(|p| p.is_number())
            .unwrap_or(false),
        "stdout must not carry the manifest"
    );
    assert!(
        output.stdout.len() < 4096,
        "pointer stays small: {} bytes",
        output.stdout.len()
    );
    let pointer_path = PathBuf::from(stdout[0]["pointer"].as_str().unwrap());
    assert!(pointer_path.exists());
    let events = lines(&String::from_utf8_lossy(&output.stderr));
    let kinds: Vec<&str> = events
        .iter()
        .map(|e| e["event"].as_str().unwrap_or("?"))
        .collect();
    assert_eq!(kinds.first(), Some(&"accepted"));
    assert_eq!(kinds.last(), Some(&"complete"));
    assert!(kinds.contains(&"progress"));
    assert!(events.iter().all(|e| e["job"] == "job"));
    fs::remove_dir_all(root).ok();
}
#[test]
fn batch_runs_every_job_and_summarises() {
    let (root, obj, cache) = fixture("batch");
    let spec = root.join("jobs.json");
    fs::write(&spec,serde_json::json!({"workers":2,"ramBudgetMb":256,"jobs":[{"id":"a","source":obj,"cache":cache.join("a"),"resourceBaseUrl":"/a/"},{"id":"b","source":obj,"cache":cache.join("b"),"resourceBaseUrl":"/b/","simplification":"qem-endpoints"},{"id":"missing","source":root.join("nope.obj"),"cache":cache.join("c"),"resourceBaseUrl":"/c/"}]}).to_string()).expect("spec");
    let output = Command::new(env!("CARGO_BIN_EXE_web-geometry-compiler"))
        .args(["--jobs", spec.to_str().unwrap()])
        .stdin(Stdio::null())
        .output()
        .expect("run");
    assert_eq!(
        output.status.code(),
        Some(2),
        "one job fails: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let summary: Value =
        serde_json::from_str(String::from_utf8_lossy(&output.stdout).trim()).expect("summary");
    assert_eq!(summary["status"], "partial");
    assert_eq!(summary["completed"], 2);
    assert_eq!(summary["failed"], 1);
    let jobs = summary["jobs"].as_array().unwrap();
    assert_eq!(jobs.len(), 3);
    assert_eq!(
        jobs.iter().find(|j| j["job"] == "a").unwrap()["status"],
        "ready"
    );
    assert_eq!(
        jobs.iter().find(|j| j["job"] == "missing").unwrap()["status"],
        "error"
    );
    let events = lines(&String::from_utf8_lossy(&output.stderr));
    assert_eq!(events[0]["event"], "batch");
    assert_eq!(events[0]["jobs"], 3);
    assert_eq!(events.iter().filter(|e| e["event"] == "queued").count(), 3);
    assert_eq!(
        events.iter().filter(|e| e["event"] == "complete").count(),
        2
    );
    assert_eq!(events.iter().filter(|e| e["event"] == "error").count(), 1);
    assert_eq!(events.last().unwrap()["event"], "done");
    assert!(cache.join("a/native/full/manifest.json").exists());
    assert!(cache.join("b/native/full/manifest.json").exists());
    fs::remove_dir_all(root).ok();
}
#[test]
fn cancel_line_on_stdin_stops_the_job() {
    let (root, obj, cache) = fixture("cancel");
    let mut child = Command::new(env!("CARGO_BIN_EXE_web-geometry-compiler"))
        .args([
            obj.to_str().unwrap(),
            cache.to_str().unwrap(),
            "full",
            "150000",
            "1",
            "64",
            "/assets/",
            "none",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn");
    // The quad compiles faster than we can cancel it; a cancel sent first must still be honoured or the job completes cleanly: both are valid outcomes, neither may hang.
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"{\"cancel\":\"*\"}\n")
        .ok();
    let output = child.wait_with_output().expect("wait");
    let stdout: Value =
        serde_json::from_str(String::from_utf8_lossy(&output.stdout).trim()).expect("stdout JSON");
    assert!(
        stdout["status"] == "ready" || stdout["code"] == "CANCELLED",
        "{stdout}"
    );
    fs::remove_dir_all(root).ok();
}
/// Le nom de chaque pilote d'une famille, dans l'ordre où le registre les publie.
fn plugin_names(plugins: &[Value]) -> Vec<&str> {
    plugins
        .iter()
        .map(|plugin| plugin["name"].as_str().expect("name"))
        .collect()
}

#[test]
fn version_flag_describes_the_build() {
    let output = Command::new(env!("CARGO_BIN_EXE_web-geometry-compiler"))
        .arg("--version")
        .output()
        .expect("run");
    let v: Value =
        serde_json::from_str(String::from_utf8_lossy(&output.stdout).trim()).expect("json");
    assert_eq!(v["compilerVersion"], env!("CARGO_PKG_VERSION"));
    // Le registre des pilotes voyage dans --version : un format par pilote, avec sa version.
    let scene = v["plugins"]["scene"].as_array().expect("scene plugins");
    assert_eq!(
        plugin_names(scene).join(" "),
        "gltf fbx obj unity blend zip unitypackage alembic usd usdz"
    );
    let fbx = scene.iter().find(|p| p["name"] == "fbx").expect("fbx");
    assert!(fbx["version"].as_str().unwrap().contains("ufbx"));
    let images = v["plugins"]["image"].as_array().expect("image plugins");
    assert_eq!(
        plugin_names(images).join(" "),
        "png jpeg tga tiff dds webp exr hdr ktx2 psd bmp gif"
    );
}
