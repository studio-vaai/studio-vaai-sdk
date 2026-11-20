#!/usr/bin/env python3
"""Writes NOTICES: the licenses of the code in the studio vaai core libraries
this package ships, for the app's license page.

Flutter reads a package's NOTICES in place of its LICENSE when it collects an
app's licenses. Sections are separated by a line of 80 hyphens; each starts
with the names of what it covers, then a blank line, then the license.

The crates are those the core links on Android, iOS and macOS: its normal
dependencies, without build scripts and procedural macros, which run only at
build time. Each section is the crate's own license file (for a choice of
licenses, MIT where offered). The Rust standard library and the Unicode CLDR
data the core's formatting carries have sections of their own.

Usage: notices.py [--check]
  --check  fail when NOTICES differs from what Cargo.lock implies
"""
import json
import pathlib
import re
import subprocess
import sys

flutter = pathlib.Path(__file__).resolve().parents[1]
core = flutter.parent / "core-rs"
output = flutter / "NOTICES"
separator = "\n" + "-" * 80 + "\n"

targets = [
    "aarch64-linux-android",
    "armv7-linux-androideabi",
    "x86_64-linux-android",
    "aarch64-apple-ios",
    "aarch64-apple-ios-sim",
    "x86_64-apple-ios",
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
]

# For a choice of licenses: the first offered, in this order.
preference = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "Zlib", "Unicode-3.0", "Unlicense"]
# License files by the license they hold, as crates name them.
file_patterns = {
    "MIT": [r"LICEN[CS]E[-_.]?MIT.*", r"COPYING"],
    "Apache-2.0": [r"LICEN[CS]E[-_.]?APACHE.*"],
    "Zlib": [r"LICEN[CS]E[-_.]?ZLIB.*"],
    "Unlicense": [r"UNLICENSE.*"],
    "Unicode-3.0": [r"LICEN[CS]E[-_.]?UNICODE.*"],
}
generic = r"LICEN[CS]E(\.md|\.txt)?"

rust_std = """MIT License

Copyright (c) The Rust Project Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""

mpl = """The studio vaai core links these crates unmodified. Their source code is
published on crates.io, at https://crates.io/crates/NAME, in the version the
SDK's Cargo.lock names.

"""
mpl_notice = """This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this file,
You can obtain one at https://mozilla.org/MPL/2.0/.
"""


def chosen(expression):
    """The licenses one must follow for an SPDX expression: all of an AND,
    the preferred one of an OR."""
    expression = expression.replace("/", " OR ")
    terms = [term.strip(" ()") for term in re.split(r"\bAND\b", expression)]
    licenses = []
    for term in terms:
        options = [option.strip(" ()") for option in re.split(r"\bOR\b", term)]
        options = [re.sub(r" WITH .*", "", option) for option in options]
        licenses.append(min(options, key=lambda o: preference.index(o) if o in preference else len(preference)))
    return licenses


def license_text(package, spdx):
    folder = pathlib.Path(package["manifest_path"]).parent
    files = sorted(path for path in folder.iterdir() if path.is_file())
    for pattern in file_patterns.get(spdx, []) + [generic]:
        for path in files:
            if re.fullmatch(pattern, path.name, re.IGNORECASE):
                text = path.read_text(errors="replace").strip() + "\n"
                # A crate's only LICENSE may hold its other license.
                if spdx != "Unicode-3.0" or "UNICODE LICENSE V3" in text:
                    return text
    return None


def unicode_license(packages):
    """The Unicode License v3, as ICU4X ships it, for crates that carry CLDR
    data without a copy of it."""
    icu = next(p for p in packages if p["name"] == "icu_locale_core")
    return license_text(icu, "Unicode-3.0")


def cargo(*args):
    return subprocess.check_output(["cargo", *args], cwd=core, stderr=subprocess.DEVNULL, text=True)


def linked_packages():
    metadata = json.loads(cargo("metadata", "--locked", "--format-version", "1"))
    by_name = {(p["name"], p["version"]): p for p in metadata["packages"]}
    linked = set()
    for target in targets:
        tree = cargo("tree", "--locked", "-p", "studio-vaai-core", "-e", "normal,no-proc-macro",
                     "--target", target, "--prefix", "none", "--format", "{p}")
        for line in tree.splitlines():
            name, version = line.split()[:2]
            linked.add((name, version.removeprefix("v")))
    return [by_name[key] for key in linked], set(metadata["workspace_members"])


def render():
    packages, workspace = linked_packages()
    sections = {}  # license text -> names

    def add(name, text):
        sections.setdefault(text, set()).add(name)

    add("studio_vaai", (flutter / "LICENSE").read_text().strip() + "\n")
    add("Rust standard library", rust_std)
    missing = []
    for package in sorted(packages, key=lambda p: p["name"]):
        name, version = package["name"], package["version"]
        own = package["id"] in workspace and not package["manifest_path"].startswith(str(core / "vendor"))
        for spdx in chosen(package.get("license") or "UNKNOWN"):
            if own and spdx == "MIT":
                continue  # studio vaai's own crates: this package's LICENSE
            text = license_text(package, spdx)
            if spdx == "MPL-2.0":
                # UniFFI's crates ship no license file: MPL's Exhibit A notice.
                text = mpl + (text or mpl_notice)
            if text is None and spdx == "Unicode-3.0":
                text = unicode_license(packages)
                name = f"Unicode CLDR data ({name})"
            if text is None:
                missing.append(f"{name} {version} ({spdx})")
            else:
                add(name, text)
    if missing:
        sys.exit("No license file for: " + ", ".join(missing))
    # This package first, then by the names each section covers.
    ordered = sorted(sections.items(), key=lambda item: (item[1] != {"studio_vaai"}, sorted(item[1])))
    return separator.join("\n".join(sorted(names)) + "\n\n" + text.rstrip("\n") for text, names in ordered) + "\n"


def main():
    check = sys.argv[1:] == ["--check"]
    notices = render()
    if check:
        if not output.exists() or output.read_text() != notices:
            sys.exit(f"{output.name} is out of date: run tool/notices.py in the Flutter package.")
        print(f"{output.name} is up to date.")
    else:
        output.write_text(notices)
        print(f"Wrote {output}")


if __name__ == "__main__":
    main()
