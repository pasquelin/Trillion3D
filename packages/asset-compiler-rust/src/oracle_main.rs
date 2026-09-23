//! Command line of the indirect lighting oracle.
//!
//! It computes nothing: it reads a JSON job, calls the library and prints its
//! report. The algorithm lives in `oracle.rs`, behind a versioned contract, like
//! the rest of the compiler.
//!
//! ```text
//! trillion3d-oracle JOB.json      # or `-` to read the job from standard input
//! ```
use std::io::Read;

/// A failure, on standard error, as JSON: a named code and a message escaped by
/// `serde_json`, never pasted as-is into quotes — a path with a quote would break
/// the line.
fn fail(code: &str, message: impl std::fmt::Display) -> ! {
    let message = serde_json::Value::String(message.to_string());
    eprintln!("{{\"code\":\"{code}\",\"message\":{message}}}");
    std::process::exit(1);
}

fn main() {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if arguments.len() != 1 {
        eprintln!("usage: trillion3d-oracle TRAVAIL.json|-");
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
    match trillion3d_compiler::oracle::job_of(&value)
        .and_then(|job| trillion3d_compiler::oracle::run(&job))
    {
        Ok(report) => println!("{report}"),
        Err(error) => fail(error.code, error.message),
    }
}
