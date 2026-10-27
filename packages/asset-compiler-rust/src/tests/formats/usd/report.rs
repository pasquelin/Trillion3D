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

    def NurbsCurves "Cheveux"
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
            "curves-unsupported": 1,
            "usd-volume-unsupported": 1,
            "usd-skel-unsupported": 1,
            "camera-unsupported": 1,
            "light-unsupported": 1,
            "usd-subdivision-unsupported": 1,
        }),
        "the menagerie report has moved"
    );
    assert_eq!(
        run.result["sourceTriangles"], 4,
        "the quad and the subdivided surface are rendered flat"
    );
}

// Behavior 34b: the `BasisCurves` of a groom are not left out: they are the strands of the groom,
// grouped, packed, and written in a product the manifest's `hairStrands` section names. Two curves
// of three and two points, a width for each curve, one group: each curve is given the control point
// at its end, so the group holds seven points.
#[test]
fn basis_curves_are_the_strands_of_a_groom() {
    let hair = format!(
        r#"{QUAD}
    def BasisCurves "Cheveux"
    {{
        int[] curveVertexCounts = [3, 2]
        point3f[] points = [(0, 0, 0), (0, 1, 0), (0, 2, 0), (1, 0, 0), (1, 1, 0)]
        float[] widths = [0.01, 0.02] (interpolation = "uniform")
    }}"#
    );
    let run = compile_layer("cheveux", &wrap("", &hair));
    assert!(
        unsupported(&run).get("curves-unsupported").is_none(),
        "curves of a groom are read"
    );
    let section = &run.result["hairStrands"];
    assert_eq!(section["version"], 1);
    assert_eq!(section["file"], "hairStrands.bin");
    assert_eq!(section["curves"], 2);
    assert_eq!(section["points"], 7);
    assert_eq!(
        section["groups"],
        json!([{"groupId": 0, "curves": 2, "points": 7, "flags": 24}])
    );
    // The head, one record, two curves padded to eight bytes, seven points, two seeds and two
    // lengths padded to words.
    assert_eq!(section["bytes"], 16 + 80 + 8 + 7 * 8 + 4 + 4);
}

// Behavior 34c: a layer of curves alone is a groom, as the reference imports one: it is compiled,
// with no mesh, and the curves of every object of the layer are merged into one groom — here two
// objects of two curves each, which share the one group, shuffled together.
#[test]
fn a_layer_of_curves_alone_is_compiled_as_one_groom() {
    let hair = r#"
    def BasisCurves "Left"
    {
        int[] curveVertexCounts = [2, 2]
        point3f[] points = [(0, 0, 0), (0, 1, 0), (1, 0, 0), (1, 1, 0)]
    }
    def Xform "Deplace"
    {
        double3 xformOp:translate = (5, 0, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]
        def BasisCurves "Right"
        {
            int[] curveVertexCounts = [2, 2]
            point3f[] points = [(0, 0, 0), (0, 1, 0), (1, 0, 0), (1, 1, 0)]
            float[] widths = [0.01, 0.02, 0.03, 0.04]
        }
    }"#;
    let dir = scratch("usd", "cheveux-seuls");
    let source = dir.join("scene.usda");
    fs::write(&source, wrap("", hair)).expect("couche");
    let answer = compile_golden_answer(&source, "cheveux-seuls");
    fs::remove_dir_all(&dir).ok();
    assert_eq!(answer["selectedNodes"], 0, "no mesh is compiled");
    let section = &answer["hairStrands"];
    assert_eq!(section["curves"], 4);
    assert_eq!(
        section["points"], 12,
        "four curves of two points, one more each"
    );
    assert_eq!(
        section["groups"],
        json!([{"groupId": 0, "curves": 4, "points": 12, "flags": 24}]),
        "one groom, one group"
    );
}

// Behavior 34d: curves a layer hides are no groom: a layer of nothing else is refused as holding
// nothing to draw, as a layer of hidden meshes is.
#[test]
fn a_layer_of_hidden_curves_alone_is_refused_as_empty() {
    let hair = r#"
    def BasisCurves "Cache"
    {
        token visibility = "invisible"
        int[] curveVertexCounts = [2]
        point3f[] points = [(0, 0, 0), (0, 1, 0)]
    }"#;
    let dir = scratch("usd", "cheveux-caches");
    let source = dir.join("scene.usda");
    fs::write(&source, wrap("", hair)).expect("couche");
    assert_eq!(
        refused_golden_source(&source, "cheveux-caches"),
        "IMPORT_EMPTY"
    );
    fs::remove_dir_all(&dir).ok();
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
    assert_eq!(unsupported(&run)["texture-missing"], 1);
    let (_, gltf) = run.prepared("usd");
    assert_eq!(gltf["materials"].as_array().map(Vec::len), Some(1));
    assert!(gltf.get("images").is_none(), "no image poured in");
}
