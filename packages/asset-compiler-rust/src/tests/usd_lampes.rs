//! Les lampes `UsdLux` d'une couche : ce qui devient une lampe `KHR_lights_punctual`, ce qui reste
//! compté, et d'où sort le rayon d'émetteur.
use super::*;
use usd_driver::{compile_layer, wrap, QUAD};

/// Les lampes de la scène intermédiaire écrite par le pilote, dans l'ordre des nœuds.
fn lights(run: &GoldenRun) -> Vec<Value> {
    let (_, gltf) = run.prepared("usd");
    gltf.pointer("/extensions/KHR_lights_punctual/lights")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

/// Le nombre écrit sur une lampe, et le message qui le situe quand il diverge.
fn close(light: &Value, key: &str, expected: f64) {
    let found = light
        .pointer(key)
        .and_then(Value::as_f64)
        .unwrap_or(f64::NAN);
    assert!(
        (found - expected).abs() <= expected.abs() * 1e-12,
        "{}{key} vaut {found}, attendu {expected}",
        light["name"]
    );
}

// Comportement : une sphère, un rectangle façonné en cône et une lampe lointaine deviennent les
// trois types de `KHR_lights_punctual`, avec le rayon d'émetteur que la couche déclare ; un schéma
// sans équivalent ponctuel, lui, reste compté par son nom.
#[test]
fn the_punctual_uslux_schemas_become_gltf_lights_and_the_others_stay_counted() {
    let body = format!(
        r#"{QUAD}
    def SphereLight "Ampoule"
    {{
        float inputs:radius = 0.25
        float inputs:intensity = 4
        color3f inputs:color = (1, 0.5, 0.25)
        bool inputs:shadow:enable = 0
    }}

    def RectLight "Panneau"
    {{
        float inputs:width = 3
        float inputs:height = 4
        float inputs:intensity = 2
        float inputs:exposure = 1
        float inputs:shaping:cone:angle = 40
        float inputs:shaping:cone:softness = 0.25
    }}

    def DistantLight "Soleil"
    {{
        float inputs:intensity = 5
    }}

    def DomeLight "Ciel"
    {{
    }}"#
    );
    let run = compile_layer("lampes", &wrap("    metersPerUnit = 1\n", &body));
    let lights = lights(&run);
    let shape: Vec<Value> = lights
        .iter()
        .map(|light| json!([&light["name"], &light["type"], &light["extras"]]))
        .collect();
    assert_eq!(
        json!(shape),
        json!([
            ["Ampoule", "point", {"castsShadow": false, "emitterRadius": 0.25}],
            ["Panneau", "spot", {"emitterRadius": 2.5}],
            ["Soleil", "directional", null],
        ]),
        "les lampes converties ont changé"
    );
    // Une sphère de rayon 0,25 présente une aire projetée de π/16 : son intensité radiante est
    // 4 · π/16 W/sr, que le glTF porte en candela. Le rectangle, exposé d'un cran, porte
    // 2 · 2 · 12 W/sr, et le soleil porte son éclairement tel quel.
    close(
        &lights[0],
        "/intensity",
        4.0 * std::f64::consts::PI * 0.0625 * 683.0,
    );
    close(&lights[1], "/intensity", 48.0 * 683.0);
    close(&lights[2], "/intensity", 5.0 * 683.0);
    close(&lights[1], "/spot/outerConeAngle", 40f64.to_radians());
    close(&lights[1], "/spot/innerConeAngle", 30f64.to_radians());
    assert_eq!(
        run.prepared("usd").0["unsupported"],
        json!({"usd-light-unsupported": 1}),
        "le DomeLight n'est plus compté"
    );
}

// Comportement : le rayon d'émetteur d'une lampe est écrit en mètres du monde — l'unité de la
// couche et l'échelle des `Xform` qui la portent comprises —, comme le contrat du moteur l'exige.
#[test]
fn the_emitter_radius_of_a_light_is_written_in_world_metres() {
    let body = format!(
        r#"{QUAD}
    def Xform "Support"
    {{
        double3 xformOp:scale = (2, 2, 2)
        uniform token[] xformOpOrder = ["xformOp:scale"]

        def SphereLight "Ampoule"
        {{
            float inputs:radius = 3
        }}
    }}"#
    );
    let run = compile_layer("lampe-echelle", &wrap("    metersPerUnit = 0.01\n", &body));
    close(&lights(&run)[0], "/extras/emitterRadius", 0.06);
}
