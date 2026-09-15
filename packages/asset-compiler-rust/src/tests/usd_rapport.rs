//! Ce que le pilote `usd` ne rend pas mais compte par son nom. Aucun de ces cas n'est un échec de
//! compilation tant qu'une surface reste : une scène qui porte un `PointInstancer` et un mur doit
//! rendre le mur et compter l'instancieur. Les refus durs sont dans `usd_refus.rs`.
use super::*;
use usd_driver::{compile_layer, wrap, QUAD};

/// Le rapport d'une couche : les raisons nommées et leur compte.
fn unsupported(run: &GoldenRun) -> Value {
    run.prepared("usd").0["unsupported"].clone()
}

// Comportement 34 : tout ce que ce pilote ne rend pas est compté par son nom, et la surface qui
// l'accompagne est rendue quand même.
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

    def DistantLight "Soleil"
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
        "le rapport de la ménagerie a bougé"
    );
    assert_eq!(
        run.result["sourceTriangles"], 4,
        "le quad et la surface subdivisée sont rendus plats"
    );
}

// Comportement 35 : un jeu de variantes n'est lu qu'à sa sélection par défaut, et le dit.
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
        "le jeu de variantes est compté"
    );
    assert_eq!(
        run.result["sourceTriangles"], 2,
        "la sélection par défaut est rendue"
    );
}

// Comportement 36 : un attribut sans valeur par défaut est lu à son premier échantillon temporel,
// la scène est figée là, et le rapport le dit — une animation n'est pas portée en silence.
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
        "le premier échantillon est signalé"
    );
    let (_, gltf) = run.prepared("usd");
    assert_eq!(
        gltf["accessors"][0]["max"],
        json!([1.0, 1.0, 0.0]),
        "c'est l'échantillon du temps le plus bas qui est figé"
    );
}

// Comportement 37 : une référence vers un fichier absent est comptée, pas devinée, et ce qui reste
// de la scène est compilé.
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
        "la référence non résolue est comptée"
    );
    assert_eq!(
        run.result["sourceTriangles"], 2,
        "le reste de la scène est rendu"
    );
}

// Comportement 38 : une texture dont le fichier n'est pas là est comptée, et le matériau reste —
// le moteur retombera sur son blanc plutôt que de perdre la surface.
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
    assert!(gltf.get("images").is_none(), "aucune image versée");
}
