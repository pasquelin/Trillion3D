use super::*;

// Comportement 23 : les cinq fixtures dorées passent par le compilateur et leur sortie est
// comparée exactement à expected.json (hors champs "case"/"rule", qui ne sont que documentaires).
#[test]
fn coplanar_fixtures_match_their_golden_expected_json() {
    let names = [
        "three-stack",
        "full-overlap",
        "partial-overlap",
        "masked-overlay",
        "blend-overlay",
    ];
    for name in names {
        let fixture_dir = golden_dir(&format!("coplanar/{name}"));
        let run = compile_golden(&fixture_dir, name);
        assert_eq!(
            coplanar_digest(&run),
            golden_expected(&fixture_dir),
            "fixture {name}: la sortie compilée diverge de expected.json"
        );
    }
}

/// Ce qu'une dorée coplanaire fixe : le rapport de l'étape, la couche de profondeur de chaque page
/// et l'identité des objets qui en ont reçu une.
fn coplanar_digest(run: &GoldenRun) -> Value {
    let depth_layer_per_page: Vec<Value> = run.result["primitives"]
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
    let coplanar = &run.result["coplanar"];
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
    json!({
      "formatVersion": run.result["formatVersion"],
      "manifestBinaryVersion": run.slim["binary"]["version"],
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
    })
}
