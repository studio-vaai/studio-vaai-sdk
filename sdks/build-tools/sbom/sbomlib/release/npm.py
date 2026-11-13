"""Pack SDK releases once, bind their inventories and publish those archives."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from ..model import digest, prop, read, write
from ..inventory.npm import npm_fragment



def integrity(path):
    with Path(path).open('rb') as stream:
        return 'sha512-' + base64.b64encode(hashlib.file_digest(stream, 'sha512').digest()).decode()


def registry_version(entry):
    url = 'https://registry.npmjs.org/' + quote(entry['name'], safe='') + '/' + quote(entry['version'], safe='')
    try:
        with urlopen(Request(url, headers={'Cache-Control': 'no-cache'}), timeout=30) as response:
            return json.load(response)
    except HTTPError as error:
        if error.code == 404:
            return None
        raise


def wait_for_registry_version(entry):
    for attempt in range(60):
        published = registry_version(entry)
        if published is not None:
            return published
        if attempt < 59:
            time.sleep(5)
    raise ValueError(f"Published version is not yet visible in the registry: {entry['name']}")


def package_order(root):
    packages = {read(p)['name']: (p, read(p)) for p in sorted((root / 'sdks').glob('*/package.json'))
                if not read(p).get('private')}
    ordered, active, done = [], set(), set()
    def visit(name):
        if name in active:
            raise ValueError(f'Cyclic SDK release dependencies: {name}')
        if name in done:
            return
        active.add(name)
        path, manifest = packages[name]
        for dependency in sorted(manifest.get('dependencies', {})):
            if dependency in packages:
                visit(dependency)
        active.remove(name)
        done.add(name)
        ordered.append(path)
    for name in packages:
        visit(name)
    return ordered


def prepare(root, output, bundles):
    output.mkdir(parents=True, exist_ok=False)
    inventories = sorted(bundles.glob('*.json'))
    entries = []
    for path in package_order(root):
        destination = output / path.parent.name
        destination.mkdir()
        subprocess.run(['pnpm', '--dir', str(path.parent), 'pack', '--pack-destination', str(destination)], check=True)
        archives = list(destination.glob('*.tgz'))
        if len(archives) != 1:
            raise ValueError(f'Expected one packed archive in {destination}')
        archive = archives[0]
        with tempfile.TemporaryDirectory() as tmp:
            with tarfile.open(archive) as tar:
                tar.extractall(tmp, filter='data')
            packed = Path(tmp) / 'package'
            manifest = read(packed / 'package.json')
            bom = npm_fragment(packed, inventories)
        bom['metadata']['component']['hashes'] = [{'alg': 'SHA-256', 'content': digest(archive)}]
        bom['metadata']['component'].setdefault('properties', []).append(prop('inventory:artifact', archive.name))
        document = destination / 'sbom.cdx.json'
        write(document, bom)
        entries.append({'name': manifest['name'], 'version': manifest['version'],
                        'archive': str(archive.relative_to(output)), 'sha256': digest(archive),
                        'integrity': integrity(archive), 'sbom': str(document.relative_to(output))})
    if not entries:
        raise ValueError('No public SDK packages found')
    write(output / 'release.json', {'sourceRevision': subprocess.check_output(
        ['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(), 'packages': entries})


def inside(directory, name):
    path = (directory / name).resolve(strict=True)
    path.relative_to(directory.resolve())
    return path


def publish(output, dry_run):
    entries = read(output / 'release.json')['packages']
    results = []
    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            existing = list(pool.map(registry_version, entries))
        for entry, published in zip(entries, existing):
            result = {'name': entry['name'], 'version': entry['version'], 'candidateIntegrity': entry['integrity']}
            results.append(result)
            if published is not None:
                # Like recursive pnpm publish, reruns skip existing versions.
                # A rebuilt candidate is not evidence for different registry bytes.
                actual = published.get('dist', {}).get('integrity')
                result.update(status='already-published', registryIntegrity=actual,
                              candidateMatchesRegistry=actual == entry['integrity'])
                print(f"Skipping existing {entry['name']}@{entry['version']}", flush=True)
                continue
            result['status'] = 'publishing'
            command = ['pnpm', 'publish', str(inside(output, entry['archive'])),
                       '--no-git-checks', '--ignore-scripts', '--skip-manifest-obfuscation']
            if dry_run:
                command.append('--dry-run')
            subprocess.run(command, check=True)
            result['status'] = 'dry-run' if dry_run else 'published-awaiting-integrity'
        # Upload in dependency order, then verify visibility. A delayed registry
        # read must not postpone every subsequent package upload.
        for entry, result in zip(entries, results):
            if result['status'] == 'published-awaiting-integrity':
                published = wait_for_registry_version(entry)
                actual = published.get('dist', {}).get('integrity')
                result['registryIntegrity'] = actual
                if actual != entry['integrity']:
                    raise ValueError(f"Published integrity differs from release archive: {entry['name']}")
                result['status'] = 'published'
    finally:
        write(output / 'publication.json', {'packages': results})


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'publish'])
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--bundles', type=Path)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args(argv)
    if args.command == 'prepare':
        if args.bundles is None:
            parser.error('--bundles is required for prepare')
        prepare(args.root.resolve(), args.output.resolve(), args.bundles.resolve())
    else:
        publish(args.output.resolve(), args.dry_run)
