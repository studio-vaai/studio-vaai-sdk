"""Resolve SDK dependencies for each declared target and bind supplied artifacts.

No native compilation is implied. --artifact TARGET=FILE attaches the exact
platform artifact built by the release process. Targets without artifacts are
explicitly marked as source inventories.
"""
import argparse
import os
from pathlib import Path
import subprocess
import tomllib
import uuid

from .. import ROOT
from ..model import digest, prop, read, write
from .cargo import rust_std


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT.parents[1] / "core-rs")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--target", action="append")
    parser.add_argument("--artifact", action="append", default=[])
    args = parser.parse_args(argv)
    config = tomllib.loads((args.root / "rust-toolchain.toml").read_text())["toolchain"]
    artifacts = dict(value.split("=", 1) for value in args.artifact)
    targets = args.target or config["targets"]
    unknown = set(artifacts) - set(targets)
    if unknown:
        parser.error(f"Artifacts supplied for undeclared targets: {sorted(unknown)}")
    env = dict(os.environ, CARGO_NET_OFFLINE="true", RUSTUP_TOOLCHAIN=config["channel"], SOURCE_DATE_EPOCH="0")
    compiler = subprocess.check_output(["rustc", "-Vv"], cwd=args.root, env=env, text=True)
    filename = ".sbom-" + uuid.uuid4().hex
    try:
        for target in targets:
            subprocess.run(["cargo-cyclonedx", "cyclonedx", "--manifest-path", "sdk-core/Cargo.toml",
                            "--format", "json", "--spec-version", "1.5", "--all", "--no-build-deps",
                            "--target", target, "--override-filename", filename], cwd=args.root, env=env, check=True)
            bom = rust_std(read(args.root / "sdk-core" / (filename + ".json")), compiler)
            root = bom["metadata"]["component"]
            root.setdefault("properties", []).append(prop("rust:toolchain", config["channel"]))
            if target in artifacts:
                artifact = Path(artifacts[target]).resolve(strict=True)
                root["hashes"] = [{"alg": "SHA-256", "content": digest(artifact)}]
                root["properties"].append(prop("inventory:artifact", artifact.name))
            else:
                root["properties"].append(prop("inventory:evidence", "resolved-source-dependencies; platform binary not inspected"))
            output = args.output / target / "sdk-core.cdx.json"
            write(output, bom)
            print(target, len(bom["components"]), "components;", "artifact bound" if target in artifacts else "source inventory")
    finally:
        for generated in args.root.rglob(filename + ".json"):
            generated.unlink()
