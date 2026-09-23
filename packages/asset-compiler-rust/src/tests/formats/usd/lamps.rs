//! `UsdLux` lights of a layer: what becomes a `KHR_lights_punctual` light, what
//! stays counted, and where the emitter radius comes from.
use super::driver::{compile_layer, wrap, QUAD};
use super::*;

/// Lights of the intermediate scene the driver wrote, in node order.
fn lights(run: &GoldenRun) -> Vec<Value> {
    let (_, gltf) = run.prepared("usd");
    gltf.pointer("/extensions/KHR_lights_punctual/lights")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

/// Number written on a light, and the message that situates it when it diverges.
fn close(light: &Value, key: &str, expected: f64) {
    let found = light
        .pointer(key)
        .and_then(Value::as_f64)
        .unwrap_or(f64::NAN);
    assert!(
        (found - expected).abs() <= expected.abs() * 1e-12,
        "{}{key} is {found}, expected {expected}",
        light["name"]
    );
}

// Behaviour: a sphere, a rectangle shaped into a cone and a distant light become
// the three `KHR_lights_punctual` types, with the emitter radius the layer
// declares; a schema without a punctual equivalent stays counted by name.
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
        "the converted lights have changed"
    );
    // A sphere of radius 0.25 has a projected area of π/16: its radiant intensity
    // is 4 · π/16 W/sr, which glTF carries in candela. The rectangle, exposed by
    // one stop, carries 2 · 2 · 12 W/sr, and the sun carries its illuminance as-is.
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
        "the DomeLight is no longer counted"
    );
}

// Behaviour: a light's emitter radius is written in world metres — the layer's
// unit and the scale of the `Xform`s that carry it included —, as the engine
// contract requires.
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
