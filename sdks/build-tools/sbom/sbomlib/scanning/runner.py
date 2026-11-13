"""Report every vulnerability finding; fail only on coverage or scanner errors."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
from .. import DATA
from .tools import fetch, install, read, run, sha, write
from .notification import grype_findings, osv_findings, summarize, markdown


@dataclass(frozen=True)
class NativeScanner:
    """Optional native advisory integration supplied by repository tooling."""
    command: tuple[str, ...]
    registry: Path
    identities: Path
    implementation_sha256: str


class CoverageError(ValueError):
    pass


def retained_coverage(root):
    """Keep discovery/binding gaps visible while scanning every available inventory."""
    rows = []
    for path in sorted(root.rglob('retained-coverage.json')):
        relative = str(path.relative_to(root))
        try:
            data = read(path)
            problems = data['problems']
            if (data.get('schemaVersion') != 1 or not isinstance(problems, list)
                    or data.get('status') != ('incomplete' if problems else 'complete')):
                raise ValueError('Invalid retained-inventory coverage record')
            for index, problem in enumerate(problems):
                if (not isinstance(problem, dict) or not isinstance(problem.get('subject'), str)
                        or not isinstance(problem.get('detail'), str) or not problem['detail']
                        or len(problem['subject']) > 2048 or len(problem['detail']) > 2048):
                    raise ValueError('Invalid retained-inventory coverage problem')
                rows.append({'document': f"{relative}#{index + 1}", 'subject': problem['subject'],
                             'exitCode': 3, 'seconds': 0,
                             'error': f"{problem['subject']}: {problem['detail']}"})
        except Exception as error:
            rows.append({'document': relative, 'exitCode': 1, 'seconds': 0, 'error': str(error)})
    return rows


def discover(root):
    documents = sorted(p for p in root.rglob('*.cdx.json') if 'components' not in p.relative_to(root).parts)
    if not documents:
        raise ValueError(f'No release inventories found: {root}')
    return documents



def selected_documents(documents):
    """Reuse verified retained evidence only for byte-identical candidate SBOMs."""
    groups, selected, aliases = {}, [], {}
    for path in documents:
        groups.setdefault(sha(path), []).append(path)
    for checksum, paths in groups.items():
        verified = []
        for path in paths:
            try:
                binding = read(path.parent / 'retained-subject.json')
                bom = read(path)
                hashes = {item['content'] for item in bom.get('metadata', {}).get('component', {}).get('hashes', [])
                          if item.get('alg') == 'SHA-256'}
                proof, subject = binding['publicationBinding'], binding['subject']
                expected = proof.get('localManifestSha256') if binding['kind'] == 'image' else subject['digest'].removeprefix('sha256:')
                method = 'oci-manifest-equivalence' if binding['kind'] == 'image' else 'exact-sdk-tarball'
                if (binding.get('schemaVersion') == 1 and binding['kind'] in ['image', 'sdk']
                        and binding.get('sbomSha256') == checksum and proof.get('method') == method
                        and expected in hashes):
                    verified.append(path)
            except (OSError, ValueError, KeyError, TypeError, AttributeError):
                # Invalid retained metadata is handled by its own scan; it must
                # never authorise dropping another candidate inventory.
                continue
        if verified:
            preferred = sorted(verified)[0]
            selected.append(preferred)
            aliases[preferred] = [path for path in paths if path in verified or not (path.parent / 'retained-subject.json').exists()]
            selected.extend(path for path in paths if path not in aliases[preferred])
        else:
            selected.extend(paths)
    return sorted(selected), aliases


def prepare(args, grype, env):
    status = args.output / 'database-status.json'
    if not args.skip_db_update:
        if run([grype, 'db', 'update'], args.output / 'database-update.log', args.output / 'database-update.stderr', env):
            raise ValueError('Grype database update failed; refusing to silently scan stale data')
    if run([grype, 'db', 'status', '-o', 'json'], status, args.output / 'database-status.stderr', env):
        raise ValueError('Grype database validation failed')
    base = read(status)
    if not base.get('valid'):
        raise ValueError('Grype database is not valid')
    if not args.preprocessor:
        return None
    registry = read(args.nvidia_registry)
    if registry['grypeVersion'] != read(DATA / 'scanners.json')['grype']['version']:
        raise ValueError('NVIDIA preprocessor and pinned Grype version differ')
    pins = registry['sources'] + registry['manifests']
    with ThreadPoolExecutor(max_workers=8) as pool:
        files = list(pool.map(lambda p: fetch(p, args.cache / 'downloads'), pins))
    base_path = Path(base['path'])
    if base_path.is_file():
        base_path = base_path.parent
    stat = (base_path / 'vulnerability.db').stat()
    identity = {'base': read(base_path / 'import.json'), 'size': stat.st_size, 'mtimeNs': stat.st_mtime_ns,
                'preprocessor': args.preprocessor.implementation_sha256, 'registry': sha(args.nvidia_registry), 'platform': args.platform}
    key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    database = args.cache / 'nvidia' / key
    command = [*args.preprocessor.command, '--registry', str(args.nvidia_registry),
               'database', '--base-db', str(base_path), '--grype', grype,
               '--platform', args.platform, '--output', str(database)]
    for index, path in enumerate(files):
        command += ['--advisory' if index < len(registry['sources']) else '--manifest', str(path)]
    if run(command, args.output / 'database-prepare.log', args.output / 'database-prepare.stderr', env):
        raise ValueError('NVIDIA database preparation failed')
    for name in ['receipt.json', 'nvidia-feed.json']:
        shutil.copyfile(database / name, args.output / name)
    # Bound persistent cache size while keeping the current database reusable.
    for previous in database.parent.iterdir():
        if previous != database and previous.is_dir():
            shutil.rmtree(previous)
    return database



def scan_osv(manifest, args, osv, env, digest):
    output = args.output / 'shared-osv' / digest
    output.mkdir(parents=True)
    start = time.monotonic()
    code = run([osv, 'scan', 'source', '--lockfile', 'osv-scanner:' + str(manifest), '--format', 'json'],
               output / 'osv.json', output / 'osv.log', env)
    if code not in [0, 1]:
        raise ValueError(f'OSV scanner failed with exit {code}; see shared-osv/{digest}/osv.log')
    data = read(output / 'osv.json')
    return {'directory': output, 'exitCode': code, 'manifestSha256': digest,
            'seconds': round(time.monotonic() - start, 3),
            'data': data,
            'advisories': sorted({v['id'] for result in data.get('results', [])
                                 for package in result.get('packages', []) for v in package.get('vulnerabilities', [])})}



def scan_one(path, args, grype, database, env, osv_results, aliases=()):
    start = time.monotonic()
    relative = str(path.relative_to(args.input))
    output = args.output / relative.removesuffix('.cdx.json')
    output.parent.mkdir(parents=True, exist_ok=True)
    row = {'document': relative, 'inputSha256': sha(path), 'exitCode': 1}
    try:
        bom = read(path)
        row['subject'] = bom.get('metadata', {}).get('component', {}).get('name', relative)
        retained = path.parent / 'retained-subject.json'
        if retained.exists():
            binding = read(retained)
            subject = binding.get('subject', {})
            if (binding.get('schemaVersion') != 1 or binding.get('kind') not in ['image', 'sdk']
                    or not isinstance(binding.get('associations'), list)
                    or not isinstance(subject.get('digest'), str)):
                raise ValueError('Invalid retained-artifact association')
            row['artifactDigest'] = subject['digest']
            row['associations'] = binding['associations']
            row['subject'] = (f"{subject['name']}@{subject['version']}" if binding['kind'] == 'sdk'
                              else f"{row['subject']}@{subject['digest']}")
        if aliases:
            row['sourceDocuments'] = sorted(str(alias.relative_to(args.input)) for alias in aliases)
            associations, subjects, digests = list(row.get('associations', [])), {row['subject']}, set()
            for alias in aliases:
                marker = alias.parent / 'retained-subject.json'
                if not marker.exists():
                    continue
                binding = read(marker)
                subject = binding['subject']
                associations.extend(binding['associations'])
                digests.add(subject['digest'])
                subjects.add(f"{subject['name']}@{subject['version']}" if binding['kind'] == 'sdk'
                             else f"{bom['metadata']['component']['name']}@{subject['digest']}")
            row['associations'] = list({json.dumps(item, sort_keys=True): item for item in associations}.values())
            row['subjects'], row['artifactDigests'] = sorted(subjects), sorted(digests)
        native = any(c.get('purl', '').startswith('pkg:nix/') or any(
            p['name'] == 'studio-vaai:nix:purl' for p in c.get('properties', [])) for c in bom.get('components', []))
        if native and not args.preprocessor:
            raise ValueError('Native identities require the NVIDIA/coverage preprocessor')
        if args.preprocessor and native:
            command = [*args.preprocessor.command, '--registry', str(args.nvidia_registry),
                       '--identities', str(args.identity_registry)]
            archived_inventory = path.parent / 'runtime-file-inventory.json'
            inventory = archived_inventory if archived_inventory.exists() else output.parent / (output.name + '-files.json')
            if retained.exists() and not archived_inventory.exists():
                raise CoverageError('Retained native SBOM lacks version-bound runtime file inventory')
            if not archived_inventory.exists() and (path.parent / 'runtime-closure.json').exists():
                inventory_start = time.monotonic()
                code = run(command + ['inventory', '--sbom', str(path), '--closure', str(path.parent / 'runtime-closure.json'),
                           '--payload-files', str(path.parent / 'payload-files.json'), '--output', str(inventory)],
                           output.parent / (output.name + '-inventory.log'), output.parent / (output.name + '-inventory.stderr'), env)
                row['fileInventorySeconds'] = round(time.monotonic() - inventory_start, 3)
                if code:
                    raise ValueError('Runtime file inventory failed; absence cannot be established')
            command += ['scan', '--sbom', str(path), '--database', str(database), '--platform', args.platform,
                        '--grype', grype, '--fail-on', args.fail_on, '--output', str(output)]
            if inventory.exists():
                command += ['--file-inventory', str(inventory)]
            if (path.parent / 'vex.openvex.json').exists():
                command += ['--vex', str(path.parent / 'vex.openvex.json')]
            code = run(command, output.parent / (output.name + '-scan.log'), output.parent / (output.name + '-scan.stderr'), env)
            if not (output / 'scan-status.json').exists():
                raise ValueError('Preprocessor did not retain a complete scan status')
            row['coverage'] = read(output / 'coverage-policy.json')
            row['grypeExitCode'] = read(output / 'scan-status.json')['grypeExitCode']
        else:
            output.mkdir()
            command = [grype, 'sbom:' + str(path), '-o', 'json', '--fail-on', args.fail_on]
            if (path.parent / 'vex.openvex.json').exists():
                command += ['--vex', str(path.parent / 'vex.openvex.json')]
            code = run(command, output / 'grype.json', output / 'grype.log', env)
        if code not in ([0, 2, 3] if args.preprocessor and native else [0, 2]):
            raise ValueError(f'Scanner failed with exit {code}; see scan.stderr or grype.log')
        grype_result = read(output / 'grype.json')
        row['_notificationFindings'] = list(grype_findings(grype_result, bom))
        row.setdefault('grypeExitCode', code)
        row.update(activeFindings=len(grype_result['matches']),
                   ignoredFindings=len(grype_result.get('ignoredMatches', [])))
        if path in osv_results:
            query = osv_results[path].result()
            row['_notificationFindings'] += list(osv_findings(query.get('data', {}), bom))
            for name in ['osv.json', 'osv.log']:
                shutil.copyfile(query['directory'] / name, output / name)
            row.update(osvExitCode=query['exitCode'], osvAdvisories=query['advisories'],
                       osvManifestSha256=query['manifestSha256'], osvQuerySeconds=query['seconds'])
            # OSV 1 means vulnerabilities; retain this diagnostic without failing release.
            if query['exitCode'] == 1 and code == 0:
                code = 2
        row['exitCode'] = code
    except Exception as error:
        output.mkdir(exist_ok=True)
        row.update(exitCode=3 if isinstance(error, CoverageError) else 1, error=str(error))
    row['seconds'] = round(time.monotonic() - start, 3)
    write(output / 'result.json', {key: value for key, value in row.items() if not key.startswith('_')})
    return row



def main(argv=None, native=None):
    cpus = os.cpu_count() or 1
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['input', 'output', 'cache']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--platform', default='linux/amd64', choices=['linux/amd64', 'linux/arm64'])
    parser.add_argument('--fail-on', default='high', choices=['negligible', 'low', 'medium', 'high', 'critical'],
                        help='Stock Grype diagnostic threshold; findings never fail this command')
    parser.add_argument('--workers', type=int, default=8 if cpus >= 16 else 4 if cpus >= 8 else 2)
    parser.add_argument('--skip-db-update', action='store_true', help='Reproduce using an existing validated database snapshot')
    args = parser.parse_args(argv)
    started = time.monotonic()
    started_at = datetime.now(timezone.utc).isoformat()
    args.preprocessor = native
    args.nvidia_registry = native.registry if native else None
    args.identity_registry = native.identities if native else None
    for name in ['input', 'output', 'cache', 'nvidia_registry', 'identity_registry']:
        if getattr(args, name):
            setattr(args, name, getattr(args, name).resolve())
    args.output.mkdir(parents=True, exist_ok=False)
    (args.cache / 'downloads').mkdir(parents=True, exist_ok=True)
    result = {'exitCode': 1, 'scanExitCode': 1, 'findingsPolicy': 'report-only', 'results': [],
              'threshold': args.fail_on, 'platform': args.platform, 'workers': args.workers}
    coverage_rows = retained_coverage(args.input)
    try:
        documents, aliases = selected_documents(discover(args.input))
        pins = read(DATA / 'scanners.json')
        result['scannerPins'] = pins
        with tempfile.TemporaryDirectory(prefix='sbom-scanners-') as tmp:
            binaries = Path(tmp)
            tool_start = time.monotonic()
            grype = install('grype', pins, args.cache / 'downloads', binaries)
            osv = install('osv-scanner', pins, args.cache / 'downloads', binaries) if any(
                (p.parent / 'osv-scanner.json').exists() for p in documents) else None
            result['toolSetupSeconds'] = round(time.monotonic() - tool_start, 3)
            env = os.environ | {'GRYPE_DB_CACHE_DIR': str(args.cache / 'base-db'), 'GRYPE_DB_AUTO_UPDATE': 'false',
                                'GRYPE_CHECK_FOR_APP_UPDATE': 'false', 'GRYPE_DB_VALIDATE_BY_HASH_ON_START': 'true',
                                'GRYPE_INCLUDE_MATCHER_SUPPRESSIONS': 'true'}
            database_start = time.monotonic()
            database = prepare(args, grype, env)
            result['databaseSeconds'] = round(time.monotonic() - database_start, 3)
            cache_identity = {'database': read(args.output / 'database-status.json')['from'],
                              'scannerPins': pins, 'platform': args.platform,
                              'preprocessor': args.preprocessor.implementation_sha256 if args.preprocessor else None,
                              'registry': sha(args.nvidia_registry) if args.nvidia_registry else None}
            cache_key = hashlib.sha256(json.dumps(cache_identity, sort_keys=True).encode()).hexdigest()
            result['cacheSnapshot'] = cache_key
            if os.environ.get('GITHUB_OUTPUT'):
                with open(os.environ['GITHUB_OUTPUT'], 'a') as out:
                    out.write(f'cache-ready=true\ncache-key={cache_key}\n')
            if args.identity_registry:
                result['identityRegistrySha256'] = sha(args.identity_registry)
                result['nvidiaRegistrySha256'] = sha(args.nvidia_registry)
                result['nvidiaReviewDate'] = read(args.nvidia_registry)['reviewedAt']
            scan_start = time.monotonic()
            with ThreadPoolExecutor(max_workers=min(args.workers, 4)) as queries, ThreadPoolExecutor(max_workers=args.workers) as pool:
                # Share only byte-identical source manifests within this run.
                # Every job performs fresh OSV queries, overlapping Grype work.
                unique, osv_results = {}, {}
                for path in documents:
                    manifest = path.parent / 'osv-scanner.json'
                    if manifest.exists():
                        digest = sha(manifest)
                        if digest not in unique:
                            unique[digest] = queries.submit(scan_osv, manifest, args, osv, env, digest)
                        osv_results[path] = unique[digest]
                result['osvManifests'] = len(osv_results)
                result['osvQueries'] = len(unique)
                result['results'] = list(pool.map(lambda p: scan_one(p, args, grype, database, env, osv_results, aliases.get(p, ())), documents))
            result['scanSeconds'] = round(time.monotonic() - scan_start, 3)
            codes = {r['exitCode'] for r in result['results']}
            result['scanExitCode'] = next((c for c in [1, 3, 2] if c in codes), 0)
            # A CVE disclosure must not prevent an unrelated bug fix or rollback.
            # Preserve scanner diagnostics and findings while enforcing scan integrity.
            result['exitCode'] = 0 if result['scanExitCode'] == 2 else result['scanExitCode']
    except Exception as error:
        result['error'] = str(error)
    result['results'].extend(coverage_rows)
    if coverage_rows:
        codes = {row['exitCode'] for row in result['results']}
        result['scanExitCode'] = next((code for code in [1, 3, 2] if code in codes), 0)
        if result.get('error'):
            result['scanExitCode'] = 1
        result['exitCode'] = 0 if result['scanExitCode'] == 2 else result['scanExitCode']
    result['seconds'] = round(time.monotonic() - started, 3)
    notification = summarize(result['results'], result, started_at)
    write(args.output / 'notification.json', notification)
    write(args.output / 'summary.json', result)
    summary = ['### SBOM vulnerability scan', '',
               f"{len(result['results'])} inventories in {result['seconds']:.1f}s using {args.workers} workers."]
    if 'scanSeconds' in result:
        summary += [f"Tool setup: {result['toolSetupSeconds']:.1f}s; database: {result['databaseSeconds']:.1f}s; "
                    f"scanning: {result['scanSeconds']:.1f}s; OSV queries: {result['osvQueries']} for {result['osvManifests']} manifests."]
    summary += ['', '| Inventory | Findings | Seconds | Result |', '| --- | ---: | ---: | --- |']
    for row in result['results']:
        summary.append(f"| {row['document']} | {row.get('activeFindings', 'error')} | {row['seconds']:.2f} | {row['exitCode']} |")
    summary += ['', 'Vulnerability findings are report-only and never prohibit release.',
                'Diagnostic results: 0 scanned; 2 vulnerability findings; 3 unaccepted coverage gap; 1 scanner/input error.',
                'Command exit: 0 for completed scans, including findings; 3 for coverage gaps; 1 for scanner/input errors.']
    if result.get('error'):
        summary += ['', result['error']]
    details = markdown(notification)
    summary_text = '\n'.join(summary) + '\n\n' + details
    (args.output / 'summary.md').write_text(summary_text)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as out:
            out.write(summary_text if len(summary_text.encode()) < 900_000 else '\n'.join(summary) + '\nFull findings are in the job log.\n')
    print(details)
    if os.environ.get('GITHUB_ACTIONS') == 'true' and any(
            row.get('activeFindings', 0) or row.get('osvExitCode') == 1 for row in result['results']):
        print('::warning title=Dependency vulnerabilities::Findings are report-only; see the full findings in the job summary and log.')
    print(f"Scanned {len(result['results'])} inventories in {result['seconds']:.1f}s; exit {result['exitCode']}; {args.output}")
    return result['exitCode']
