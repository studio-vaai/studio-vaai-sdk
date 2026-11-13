//! Compiles the SDK's messages (`messages/locales/<tag>.json`) into one
//! MF2 catalog per locale and generates the table that embeds them. The
//! catalogs carry the locale data their messages need — plural rules and
//! number symbols — so the client links no CLDR tables.

use std::fmt::Write as _;
use std::path::PathBuf;
use std::{env, fs};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let root = manifest_dir.join("messages");
    println!("cargo:rerun-if-changed={}", root.display());
    let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));

    let outcome = mf2_build::Build::at(&root, out.join("mf2"))
        .source_locale("en")
        .features(mf2_build::Features::from_names([
            "native",
            "native-number-builtin",
        ]))
        .emit(mf2_build::Emit::Catalogs)
        .run()
        .unwrap_or_else(|error| panic!("the messages do not build: {error}"));
    if !outcome.is_clean() {
        let mut text = String::new();
        for diagnostic in &outcome.report.diagnostics {
            diagnostic.write_text(&mut text);
            text.push('\n');
        }
        panic!("the messages do not build:\n{text}");
    }

    let mut generated = String::new();
    let manifest_path = out.join("manifest.mf2m");
    fs::write(&manifest_path, outcome.manifest.write()).expect("write manifest.mf2m");
    writeln!(
        generated,
        "pub(crate) static MANIFEST_BYTES: &[u8] = include_bytes!({manifest_path:?});"
    )
    .unwrap();
    writeln!(
        generated,
        "pub(crate) const MANIFEST_HASH: u64 = {};",
        outcome.manifest_hash
    )
    .unwrap();
    writeln!(
        generated,
        "pub(crate) static IDS: &[&str] = &{:?};",
        outcome.manifest.ids
    )
    .unwrap();
    writeln!(
        generated,
        "pub(crate) static CATALOGS: &[(&str, &[u8])] = &["
    )
    .unwrap();
    for catalog in &outcome.catalogs {
        let path = out.join(format!("{}.mf2b", catalog.tag));
        fs::write(&path, &catalog.bytes).expect("write the catalog");
        writeln!(
            generated,
            "    ({:?}, include_bytes!({:?})),",
            catalog.tag, path
        )
        .unwrap();
        println!(
            "cargo:warning={}: {} bytes, {} brotli; locale entries {:?}",
            catalog.tag,
            catalog.bytes.len(),
            catalog.br.len(),
            catalog.locale_entries
        );
    }
    writeln!(generated, "];").unwrap();
    fs::write(out.join("catalogs.rs"), generated).expect("write catalogs.rs");
}
