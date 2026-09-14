use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

// Comportement 23 : les cinq fixtures dorées passent par le compilateur et leur sortie est
// comparée exactement à expected.json (hors champs "case"/"rule", qui ne sont que documentaires).
#[test]
fn coplanar_fixtures_match_their_golden_expected_json() {
  use std::path::PathBuf;
  let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  let names = [
    "three-stack",
    "full-overlap",
    "partial-overlap",
    "masked-overlay",
    "blend-overlay",
  ];
  for name in names {
    let fixture_dir = manifest_dir.join("fixtures/coplanar").join(name);
    let expected: Value = serde_json::from_slice(
      &fs::read(fixture_dir.join("expected.json")).unwrap_or_else(|e| panic!("{name}: expected.json: {e}")),
    )
    .unwrap_or_else(|e| panic!("{name}: expected.json is not valid JSON: {e}"));
    let root = std::env::temp_dir().join(format!(
      "wg-golden-{name}-{}-{}",
      std::process::id(),
      SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos(),
    ));
    let options = Options {
      source: fixture_dir.join(format!("{name}.gltf")),
      cache: root.join("cache"),
      resource_base: "/assets".into(),
      scope: "full".into(),
      triangle_budget: 1_000_000,
      threads: 1,
      ram_budget_mb: 64,
      simplification: "none".into(),
      cancelled: Arc::new(AtomicBool::new(false)),
    };
    let result = compile(&options, |_| {}).unwrap_or_else(|e| panic!("{name}: compile: {e}"));
    let key = result["key"].as_str().expect("key");
    let slim: Value = serde_json::from_slice(
      &fs::read(
        options
          .cache
          .join("native")
          .join(&options.scope)
          .join(key)
          .join("clusters.json"),
      )
      .expect("clusters.json"),
    )
    .expect("clusters.json is valid JSON");
    let depth_layer_per_page: Vec<Value> = result["primitives"]
      .as_array()
      .expect("primitives")
      .iter()
      .flat_map(|primitive| {
        primitive["pages"]
          .as_array()
          .expect("pages")
          .iter()
          .map(|page| page.get("depthLayer").cloned().unwrap_or(json!(0)))
      })
      .collect();
    let coplanar = &result["coplanar"];
    let layered_objects: Vec<Value> = coplanar["objects"]
      .as_array()
      .expect("coplanar.objects")
      .iter()
      .map(|object| {
        json!({
          "node": object["node"], "mesh": object["mesh"], "primitive": object["primitive"],
          "material": object["material"], "layer": object["layer"], "area": object["area"],
        })
      })
      .collect();
    let actual = json!({
      "formatVersion": result["formatVersion"],
      "manifestBinaryVersion": slim["binary"]["version"],
      "coplanar": {
        "stage": coplanar["stage"], "surfaces": coplanar["surfaces"], "planes": coplanar["planes"],
        "candidatePlanes": coplanar["candidatePlanes"], "overlaps": coplanar["overlaps"],
        "overlapArea": coplanar["overlapArea"], "layeredClusters": coplanar["layeredClusters"],
        "layerOverflow": coplanar["layerOverflow"], "instanceConflicts": coplanar["instanceConflicts"],
        "unreadSurfaces": coplanar["unreadSurfaces"], "skippedPairs": coplanar["skippedPairs"],
        "droppedPlanes": coplanar["droppedPlanes"], "layeredPages": coplanar["layeredPages"],
      },
      "depthLayerPerPage": depth_layer_per_page,
      "layeredObjects": layered_objects,
    });
    let mut expected_subset = expected.clone();
    if let Some(object) = expected_subset.as_object_mut() {
      object.remove("case");
      object.remove("rule");
    }
    assert_eq!(actual, expected_subset, "fixture {name}: la sortie compilée diverge de expected.json");
    let _ = fs::remove_dir_all(&root);
  }
}
