//! Ligne de commande de l'oracle d'éclairage indirect.
//!
//! Elle ne calcule rien : elle lit un travail JSON, appelle la bibliothèque et imprime son rapport.
//! L'algorithme vit dans `oracle.rs`, derrière un contrat versionné, comme le reste du compilateur.
//!
//! ```text
//! web-geometry-oracle TRAVAIL.json      # ou `-` pour lire le travail sur l'entrée standard
//! ```
use std::io::Read;

fn main() {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if arguments.len() != 1 {
        eprintln!("usage: web-geometry-oracle TRAVAIL.json|-");
        std::process::exit(2);
    }
    let text = if arguments[0] == "-" {
        let mut buffer = String::new();
        if let Err(error) = std::io::stdin().read_to_string(&mut buffer) {
            eprintln!("{{\"code\":\"IO_ERROR\",\"message\":\"{error}\"}}");
            std::process::exit(1);
        }
        buffer
    } else {
        match std::fs::read_to_string(&arguments[0]) {
            Ok(text) => text,
            Err(error) => {
                eprintln!("{{\"code\":\"IO_ERROR\",\"message\":\"{error}\"}}");
                std::process::exit(1);
            }
        }
    };
    let value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("{{\"code\":\"INVALID_JSON\",\"message\":\"{error}\"}}");
            std::process::exit(1);
        }
    };
    let report = web_geometry_compiler::oracle::job_of(&value)
        .and_then(|job| web_geometry_compiler::oracle::run(&job));
    match report {
        Ok(report) => println!("{report}"),
        Err(error) => {
            eprintln!(
                "{{\"code\":\"{}\",\"message\":{}}}",
                error.code,
                serde_json::Value::String(error.message)
            );
            std::process::exit(1);
        }
    }
}
