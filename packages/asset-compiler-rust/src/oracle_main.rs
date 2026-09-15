//! Ligne de commande de l'oracle d'éclairage indirect.
//!
//! Elle ne calcule rien : elle lit un travail JSON, appelle la bibliothèque et imprime son rapport.
//! L'algorithme vit dans `oracle.rs`, derrière un contrat versionné, comme le reste du compilateur.
//!
//! ```text
//! web-geometry-oracle TRAVAIL.json      # ou `-` pour lire le travail sur l'entrée standard
//! ```
use std::io::Read;

/// Un échec, sur la sortie d'erreur, en JSON : un code nommé et un message échappé par `serde_json`,
/// jamais collé tel quel dans des guillemets — un chemin à guillemet casserait la ligne.
fn fail(code: &str, message: impl std::fmt::Display) -> ! {
    let message = serde_json::Value::String(message.to_string());
    eprintln!("{{\"code\":\"{code}\",\"message\":{message}}}");
    std::process::exit(1);
}

fn main() {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if arguments.len() != 1 {
        eprintln!("usage: web-geometry-oracle TRAVAIL.json|-");
        std::process::exit(2);
    }
    let text = if arguments[0] == "-" {
        let mut buffer = String::new();
        std::io::stdin().read_to_string(&mut buffer).map(|_| buffer)
    } else {
        std::fs::read_to_string(&arguments[0])
    }
    .unwrap_or_else(|error| fail("IO_ERROR", error));
    let value = serde_json::from_str(&text).unwrap_or_else(|error| fail("INVALID_JSON", error));
    match web_geometry_compiler::oracle::job_of(&value)
        .and_then(|job| web_geometry_compiler::oracle::run(&job))
    {
        Ok(report) => println!("{report}"),
        Err(error) => fail(error.code, error.message),
    }
}
