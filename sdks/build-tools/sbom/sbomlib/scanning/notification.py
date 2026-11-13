"""Complete, source-linked scan results for notification consumers."""
from collections import Counter
from datetime import datetime, timezone
import html
import os
import re
from urllib.parse import quote
from urllib.parse import urlsplit

SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Negligible', 'Unknown']
NIX_OUTPUT = re.compile(r'/nix/store/[0-9abcdfghijklmnpqrsvwxyz]{32}-[A-Za-z0-9+._?=-]+')


def https_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        return False
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    return parsed.scheme == 'https' and bool(parsed.hostname) and not parsed.username and not parsed.password


def advisory_links(vulnerability, related=()):
    """Keep identifiers and publisher advisories independently clickable."""
    records = [vulnerability, *related]
    links = {}
    for record in records:
        identifier = record.get('id', '')
        url = record.get('dataSource')
        if not https_url(url):
            if identifier.startswith('CVE-'):
                url = 'https://www.cve.org/CVERecord?id=' + identifier
            elif identifier.startswith('GHSA-'):
                url = 'https://github.com/advisories/' + identifier
        if https_url(url):
            links[(identifier, url)] = {'label': identifier[:100], 'url': url}
    urls = [url for record in records for url in record.get('urls', [])]
    urls += [r.get('url') for record in records for r in record.get('references', []) if r.get('type') in ['ADVISORY', 'REPORT']]
    for url in urls:
        if https_url(url) and any(part in url for part in ['/security/', '/secadv/', '/securityadvisory/', '/security-advisories/']):
            links[('Vendor advisory', url)] = {'label': 'Vendor advisory', 'url': url}
    ranked = sorted(links.values(), key=lambda item: (0 if item['label'].startswith('CVE-') else 1 if item['label'].startswith('GHSA-') else 2, item['label'], item['url']))
    return ranked


def grype_findings(data, bom):
    nix_outputs = {}
    for component in bom.get('components', []):
        purl = component.get('purl', '')
        if not purl.startswith('pkg:nix/'):
            continue
        paths = {p['value'] for p in component.get('properties', []) if p['name'] == 'studio-vaai:nix:store-path'}
        outputs = nix_outputs.setdefault(purl, set())
        if (paths and all(NIX_OUTPUT.fullmatch(path) for path in paths)
                and any(purl.endswith('?store_path=' + quote(path, safe='')) for path in paths)):
            outputs.update(paths)
        else:
            outputs.add(None)

    for match in data.get('matches', []):  # Ignored/VEX-suppressed matches stay in the full reports only.
        package, vulnerability = match['artifact'], match['vulnerability']
        related = match.get('relatedVulnerabilities', [])
        purl = package.get('purl', '')
        yield {'package': package['name'], 'version': package.get('version', ''),
               'ecosystem': purl.removeprefix('pkg:').split('/', 1)[0],
               'nixOutputs': nix_outputs.get(purl),
               'aliases': sorted({v['id'] for v in [vulnerability, *related]}),
               'severity': vulnerability.get('severity') if vulnerability.get('severity') in SEVERITIES else 'Unknown',
               'fixVersions': vulnerability.get('fix', {}).get('versions', []),
               'links': advisory_links(vulnerability, related)}


def osv_findings(data, bom):
    components = [bom.get('metadata', {}).get('component', {}), *bom.get('components', [])]
    for result in data.get('results', []):
        for package in result.get('packages', []):
            identity = package['package']
            commit = identity.get('commit')
            bound = [c for c in components if commit and any(
                p.get('name') == 'studio-vaai:source:commit' and p.get('value') == commit for p in c.get('properties', []))]
            # Keep exact commit identity if the source cannot be bound to an installed version.
            identities = bound or [{'name': identity['name'], 'version': identity.get('version') or commit or 'unknown'}]
            for vulnerability in package.get('vulnerabilities', []):
                group = next((g for g in package.get('groups', []) if vulnerability['id'] in g.get('aliases', g.get('ids', []))), {})
                try:
                    score = float(group.get('max_severity', 0))
                except (ValueError, TypeError):
                    score = 0
                severity = ('Critical' if score >= 9 else 'High' if score >= 7 else 'Medium' if score >= 4 else 'Low' if score > 0 else 'Unknown')
                fixed = [event['fixed'] for affected in vulnerability.get('affected', [])
                         for span in affected.get('ranges', []) for event in span.get('events', []) if event.get('fixed')]
                for component in identities:
                    yield {'package': component['name'], 'version': component.get('version', ''),
                           'ecosystem': component.get('purl', '').removeprefix('pkg:').split('/', 1)[0] or identity.get('ecosystem', ''),
                           'aliases': sorted({vulnerability['id'], *vulnerability.get('aliases', []), *group.get('aliases', [])}),
                           'severity': severity, 'fixVersions': fixed, 'links': advisory_links(vulnerability)}


def summarize(rows, result, started_at):
    """Deduplicate package/version advisory aliases across artifacts without dropping findings."""
    grouped = {}
    for row in rows:
        artifact = row.get('subject') or row['document'].removesuffix('.cdx.json').removesuffix('/sbom')
        artifacts = row.get('subjects') or [artifact]
        for finding in row.pop('_notificationFindings', []):
            package = (finding['package'], finding['version'], finding['ecosystem'])
            bucket = grouped.setdefault(package, [])
            aliases = set(finding['aliases'])
            overlaps = [item for item in bucket if aliases & item['aliases']]
            merged = {'aliases': aliases, 'links': {}, 'fixVersions': set(),
                      'artifactOutputs': {artifact: set(finding.get('nixOutputs') or [None]) for artifact in artifacts},
                      'severity': finding['severity'] if finding['severity'] in SEVERITIES else 'Unknown'}
            for item in [finding, *overlaps]:
                merged['aliases'].update(item['aliases'])
                merged['fixVersions'].update(item['fixVersions'])
                for link in (item['links'].values() if isinstance(item['links'], dict) else item['links']):
                    merged['links'][(link['label'], link['url'])] = link
                if SEVERITIES.index(item['severity']) < SEVERITIES.index(merged['severity']):
                    merged['severity'] = item['severity']
            for item in overlaps:
                for subject, paths in item['artifactOutputs'].items():
                    merged['artifactOutputs'].setdefault(subject, set()).update(paths)
                bucket.remove(item)
            bucket.append(merged)
    findings = []
    for (package, version, ecosystem), items in grouped.items():
        for item in items:
            aliases = sorted(item['aliases'], key=lambda value: (not value.startswith('CVE-'), value))
            links = sorted(item['links'].values(), key=lambda link: (0 if link['label'].startswith('CVE-') else 1 if link['label'].startswith('GHSA-') else 2, link['label'], link['url']))
            finding = {'package': package, 'version': version, 'ecosystem': ecosystem,
                       'id': aliases[0], 'aliases': aliases, 'severity': item['severity'],
                       'artifacts': sorted(item['artifactOutputs']), 'fixVersions': sorted(item['fixVersions']), 'links': links}
            # An occurrence without build evidence keeps this subject outside output-based reviews.
            outputs = {subject: sorted(paths) for subject, paths in sorted(item['artifactOutputs'].items()) if None not in paths}
            if outputs:
                finding['artifactNixOutputs'] = outputs
            findings.append(finding)
    findings.sort(key=lambda item: (SEVERITIES.index(item['severity']), item['package'], item['version'], item['id']))
    problems = [{'document': row['document'], 'kind': 'coverage' if row['exitCode'] == 3 else 'scanner',
                 'detail': row.get('error') or ('Dependency coverage incomplete' if row['exitCode'] == 3 else 'Dependency scan failed')}
                for row in rows if row['exitCode'] in [1, 3]]
    if result.get('error'):
        problems.append({'document': '', 'kind': 'scanner', 'detail': result['error']})
    return {'schemaVersion': 1,
            'run': {'repository': os.environ.get('GITHUB_REPOSITORY', ''), 'id': os.environ.get('GITHUB_RUN_ID', ''),
                    'attempt': os.environ.get('GITHUB_RUN_ATTEMPT', ''), 'revision': os.environ.get('GITHUB_SHA', '')},
            'startedAt': started_at, 'completedAt': datetime.now(timezone.utc).isoformat(),
            'status': 'incomplete' if result['exitCode'] else 'findings' if findings else 'clean',
            'findingsTotal': len(findings), 'packagesTotal': len(grouped),
            'counts': dict(Counter(item['severity'] for item in findings)),
            'findings': findings, 'problems': problems}


def markdown(report):
    """Human-readable full findings for job summaries and logs."""
    def code(value):
        return '`' + html.escape(' '.join(str(value).split()).replace('`', "'")) + '`'
    lines = ['### Full dependency findings', '']
    for finding in report['findings']:
        lines += [f"**{finding['severity']}** · {code(finding['package'])} {code(finding['version'])}",
                  '- Advisories: ' + ', '.join(code(value) for value in finding['aliases']),
                  '- In: ' + ', '.join(code(value) for value in finding['artifacts']),
                  '- Fix versions: ' + (', '.join(code(value) for value in finding['fixVersions']) or 'none reported')]
        lines += ['- ' + quote(link['url'], safe=":/?#[]@!$&'()*+,;=%") for link in finding['links']]
        lines.append('')
    for problem in report['problems']:
        lines += [f"Scan error · {code(problem['document'])}: {code(problem['detail'])}", '']
    return '\n'.join(lines)
