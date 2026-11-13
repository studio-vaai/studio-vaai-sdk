"""Deployed npm packages, emitted bundles and external requirements."""
import json
from pathlib import Path
import re
import shutil
from ..model import component, document, prop, read, unique


def package_name(component):
    return '/'.join(filter(None, [component.get('group'), component['name']]))


def npm_fragment(root, bundles=(), embedded=()):
    root = Path(root)
    manifest = read(root / "package.json")
    main = component(manifest["name"], manifest["version"], "npm", type="application")
    license = manifest.get("license")
    if isinstance(license, str):
        main["licenses"] = ([{"license": {"name": license}}] if license.startswith("SEE LICENSE") or license == "UNLICENSED"
                            else [{"expression": license}])
    components, edges, package_refs = {}, {main["bom-ref"]: set()}, {}
    # Scan the final tree, including pnpm's virtual store, after pruning. Do
    # not follow arbitrary symlinks into the build workspace.
    manifests = sorted((root / "node_modules").rglob("package.json")) if (root / "node_modules").exists() else []
    for path in manifests:
        if path.parent.parent.name != "node_modules" and not (
                path.parent.parent.name.startswith("@") and path.parent.parent.parent.name == "node_modules"):
            continue
        p = read(path)
        if not p.get("name") or not p.get("version"):
            continue
        c = component(p["name"], p["version"], "npm")
        if isinstance(p.get("license"), str) and not p["license"].startswith("SEE LICENSE"):
            c["licenses"] = [{"expression": p["license"]}]
        c["properties"] = [prop("npm:evidence", "installed-package"),
                           prop("npm:manifest", str(path.relative_to(root)))]
        ref = c["bom-ref"]
        if ref != main["bom-ref"]:
            old = components.get(ref, {})
            c["properties"] = unique(old.get("properties", []) + c["properties"])
            components[ref] = c
            package_refs[path.parent.resolve()] = ref
            # All packages physically shipped are inventory members, even
            # orphan packages left by the package manager.
            edges[main["bom-ref"]].add(ref)
    def resolve(directory, name):
        for parent in [directory, *directory.parents]:
            target = parent / "node_modules" / name
            if target.exists():
                try:
                    target.resolve().relative_to(root.resolve())
                except ValueError:
                    continue
                if target.resolve() in package_refs:
                    return package_refs[target.resolve()]
        return None
    for path in manifests:
        p = read(path)
        ref = package_refs.get(path.parent.resolve())
        if ref is None:
            continue
        edges.setdefault(ref, set()).update(filter(None, (
            resolve(path.parent, name) for name in p.get("dependencies", {}))))
    bundle_metadata = {}
    for bundle in bundles:
        data = read(bundle)
        subject = data["metadata"]["component"]
        if package_name(subject) != manifest["name"]:
            continue
        aliases = {subject["bom-ref"]: main["bom-ref"]}
        main.update({key: value for key, value in subject.items() if key != "bom-ref"})
        bundle_metadata.update({key: value for key, value in data["metadata"].items() if key != "component"})
        for source in data.get("components", []):
            c = dict(source)
            ref = c.get("purl", c["bom-ref"]).split("?", 1)[0]
            aliases[c["bom-ref"]] = ref
            if ref == main["bom-ref"]:
                continue
            c["bom-ref"] = ref
            c["properties"] = unique(components.get(ref, {}).get("properties", []) +
                                     c.get("properties", []) + [prop("npm:evidence", "bundled-module")])
            components[ref] = c
            edges[main["bom-ref"]].add(ref)
        for edge in data.get("dependencies", []):
            edges.setdefault(aliases.get(edge["ref"], edge["ref"]), set()).update(
                aliases.get(ref, ref) for ref in edge.get("dependsOn", []))
    # A frontend can import an already bundled SDK. Follow only the SDKs
    # present in its emitted chunks or deployed package tree.
    remaining = [read(path) for directory in embedded for path in sorted(Path(directory).glob("*.cdx.json"))]
    while remaining:
        selected = [doc for doc in remaining if doc["metadata"]["component"]["bom-ref"] in components]
        if not selected:
            break
        for doc in selected:
            remaining.remove(doc)
            embedded_root = doc["metadata"]["component"]
            selected_root = components[embedded_root["bom-ref"]]
            selected_root["properties"] = unique(selected_root.get("properties", []) + embedded_root.get("properties", []))
            for c in doc.get("components", []):
                ref = c["bom-ref"]
                previous = components.get(ref, {})
                c = dict(c)
                c["properties"] = unique(previous.get("properties", []) + c.get("properties", []))
                components[ref] = c
            for edge in doc.get("dependencies", []):
                edges.setdefault(edge["ref"], set()).update(edge.get("dependsOn", []))
    # A library may deliberately leave imports external. Record requirements
    # with version ranges as properties, never invent an installed peer version.
    for kind in ["dependencies", "peerDependencies", "optionalDependencies"]:
        for name, version in sorted(manifest.get(kind, {}).items()):
            main.setdefault("properties", []).append(prop(f"npm:{kind}:{name}", version))
    for name, metadata in sorted(manifest.get("peerDependenciesMeta", {}).items()):
        main.setdefault("properties", []).append(prop(f"npm:peerDependenciesMeta:{name}", json.dumps(metadata, sort_keys=True)))
    result = document(main, list(components.values()), edges)
    external_requirements(result)
    result["metadata"].update(bundle_metadata)
    return result



def prune_npm(root):
    # Match the existing deployment policy in both pnpm virtual-store and
    # hoisted layouts. These packages support builds, declarations and linting.
    pattern = re.compile(r"^(?:typescript|vitest|knip|oxlint|oxfmt|dependency-cruiser|openapi-typescript|@types/.*|@typescript[/-].*|@vitest/.*|@oxlint[/-].*)$")
    removed = []
    for path in sorted(Path(root).rglob("package.json")):
        if not path.exists():
            continue
        if path.parent.parent.name != "node_modules" and not (
                path.parent.parent.name.startswith("@") and path.parent.parent.parent.name == "node_modules"):
            continue
        manifest = read(path)
        if pattern.fullmatch(manifest.get("name", "")):
            removed.append(manifest["name"])
            shutil.rmtree(path.parent)
    return sorted(set(removed))



def external_requirements(bom):
    """Keep consumer constraints as metadata, never as installed components."""
    removed = {c['bom-ref'] for c in bom.get('components', [])
               if any(p['name'] == 'studio-vaai:npm:delivery' and p['value'] == 'external'
                      for p in c.get('properties', []))}
    if removed:
        # Also upgrade constituent inventories produced before constraints were
        # moved onto the declaring package. Keep the requirement metadata.
        parents = {c['bom-ref']: c for c in [bom['metadata']['component'], *bom.get('components', [])]}
        for edge in bom.get('dependencies', []):
            for ref in set(edge.get('dependsOn', [])) & removed:
                c = parents[ref]
                relationships = {p['value'] for p in c.get('properties', [])
                                 if p['name'] == 'studio-vaai:npm:relationship'}
                requirements = {p['value'] for p in c.get('properties', [])
                                if p['name'] == 'studio-vaai:npm:requirement'}
                parent = parents[edge['ref']]
                parent.setdefault('properties', []).extend(
                    prop('npm:' + relationship + ':' + c['name'], requirement)
                    for relationship in sorted(relationships) for requirement in sorted(requirements))
                if c.get('scope') == 'optional' and 'peerDependencies' in relationships:
                    parent['properties'].append(prop('npm:peerDependenciesMeta:' + c['name'], '{"optional": true}'))
            edge['dependsOn'] = [ref for ref in edge.get('dependsOn', []) if ref not in removed]
        bom['components'] = [c for c in bom.get('components', []) if c['bom-ref'] not in removed]
        bom['dependencies'] = [e for e in bom.get('dependencies', []) if e['ref'] not in removed]
    for c in [bom['metadata']['component'], *bom.get('components', [])]:
        if c.get('properties'):
            c['properties'] = unique(c['properties'])
    return len(removed)
