//! What `usd` driver does not render but counts by name. None of these cases is a compilation
//! failure as long as a surface remains: scene carrying `PointInstancer` and a wall must
//! render wall and count instancer. Hard refusals in `refusal.rs`.
use super::driver::{compile_layer, wrap, QUAD};
use super::*;

/// Layer report: named reasons and count.
fn unsupported(run: &GoldenRun) -> Value {
    run.prepared("usd").0["unsupported"].clone()
}

// Behavior 34: everything this driver does not render counted by name, surface
// accompanying rendered anyway.
#[test]
fn everything_this_driver_does_not_carry_is_counted_by_its_name() {
    let menagerie = format!(
        r#"{QUAD}
    def PointInstancer "Semis"
    {{
        point3f[] positions = [(0, 0, 0)]
    }}

    def BasisCurves "Cheveux"
    {{
        int[] curveVertexCounts = [2]
        point3f[] points = [(0, 0, 0), (0, 1, 0)]
    }}

    def Volume "Fumee"
    {{
    }}

    def SkelRoot "Personnage"
    {{
    }}

    def Camera "Oeil"
    {{
    }}

    def DomeLight "Ciel"
    {{
    }}

    def Mesh "Subdivise"
    {{
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 1, 2, 3]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)]
        uniform token subdivisionScheme = "catmullClark"
    }}"#
    );
    let run = compile_layer("menagerie", &wrap("", &menagerie));
    assert_eq!(
        unsupported(&run),
        json!({
            "usd-point-instancer-unsupported": 1,
            "usd-curves-unsupported": 1,
            "usd-volume-unsupported": 1,
            "usd-skel-unsupported": 1,
            "usd-camera-unsupported": 1,
            "usd-light-unsupported": 1,
            "usd-subdivision-unsupported": 1,
        }),
        "the menagerie report has moved"
    );
    assert_eq!(
        run.result["sourceTriangles"], 4,
        "the quad and the subdivided surface are rendered flat"
    );
}

// Behavior 35: variant set read only at default selection, states so.
#[test]
fn a_variant_set_is_read_at_its_default_selection_and_says_so() {
    let body = format!(
        r#"    def Xform "Choix" (
        variants = {{
            string look = "simple"
        }}
        prepend variantSets = "look"
    )
    {{
        variantSet "look" = {{
            "simple" {{
{QUAD}            }}
            "riche" {{
            }}
        }}
    }}"#
    );
    let run = compile_layer("variantes", &wrap("", &body));
    assert_eq!(
        unsupported(&run)["usd-variants-unsupported"],
        1,
        "the variant set is counted"
    );
    assert_eq!(
        run.result["sourceTriangles"], 2,
        "the default selection is rendered"
    );
}

// Behavior 36: attribute without default value read at first time sample,
// scene frozen there, report states so — animation not carried silently.
#[test]
fn an_attribute_without_a_default_is_read_at_its_first_time_sample() {
    let mesh = r#"
    def Mesh "Anime"
    {
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 1, 2, 3]
        point3f[] points.timeSamples = {
            2: [(0, 0, 0), (2, 0, 0), (2, 2, 0), (0, 2, 0)],
            1: [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)],
        }
        uniform token subdivisionScheme = "none"
    }
"#;
    let run = compile_layer("echantillons", &wrap("", mesh));
    assert!(
        unsupported(&run)["usd-animation-first-sample"]
            .as_u64()
            .is_some(),
        "the first sample is reported"
    );
    let (_, gltf) = run.prepared("usd");
    assert_eq!(
        gltf["accessors"][0]["max"],
        json!([1.0, 1.0, 0.0]),
        "it is the sample of the lowest time that is frozen"
    );
}

// Behavior 37: reference to missing file counted, not guessed, remaining
// scene compiled.
#[test]
fn a_reference_to_a_missing_file_is_counted_and_the_rest_still_compiles() {
    let body = format!(
        r#"{QUAD}
    def Xform "Manquant" (
        prepend references = @./introuvable.usda@</Root>
    )
    {{
    }}"#
    );
    let run = compile_layer("reference", &wrap("", &body));
    assert!(
        unsupported(&run)["usd-composition-invalid"]
            .as_u64()
            .unwrap_or(0)
            > 0,
        "the unresolved reference is counted"
    );
    assert_eq!(
        run.result["sourceTriangles"], 2,
        "the rest of the scene is rendered"
    );
}

// Behavior 38: texture with missing file counted, material remains —
// engine falls back to default white rather than losing surface.
#[test]
fn a_texture_whose_file_is_missing_is_counted_and_the_material_stays() {
    let body = r#"    def Mesh "Quad" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 1, 2, 3]
        rel material:binding = </Root/M>
        point3f[] points = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)]
        uniform token subdivisionScheme = "none"
    }

    def Material "M"
    {
        token outputs:surface.connect = </Root/M/S.outputs:surface>

        def Shader "S"
        {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor.connect = </Root/M/T.outputs:rgb>
            token outputs:surface
        }

        def Shader "T"
        {
            uniform token info:id = "UsdUVTexture"
            asset inputs:file = @./absente.png@
            float3 outputs:rgb
        }
    }"#;
    let run = compile_layer("texture", &wrap("", body));
    assert_eq!(unsupported(&run)["usd-texture-missing"], 1);
    let (_, gltf) = run.prepared("usd");
    assert_eq!(gltf["materials"].as_array().map(Vec::len), Some(1));
    assert!(gltf.get("images").is_none(), "no image poured in");
}
