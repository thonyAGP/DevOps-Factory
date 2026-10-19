"""Read dependency audit reports without installing or running repository code."""
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
project = os.environ['TRIAGE_REPO']
sha = os.environ['TRIAGE_SHA']
results = []
for lock in sorted(root.rglob('*lock*')):
    if lock.name not in ('pnpm-lock.yaml', 'package-lock.json') or any(p in ('.git', 'node_modules') for p in lock.relative_to(root).parts):
        continue
    directory = lock.parent
    if not (directory / 'package.json').exists():
        continue
    relative = str(lock.relative_to(root))
    for production in (False, True):
        command = ['pnpm', 'audit', '--json'] if lock.name == 'pnpm-lock.yaml' else ['npm', 'audit', '--json', '--package-lock-only']
        if production:
            command += ['--prod'] if lock.name == 'pnpm-lock.yaml' else ['--omit=dev']
        entry = {'lockfile': relative, 'scope': 'production' if production else 'all', 'status': 'unavailable'}
        try:
            process = subprocess.run(command, cwd=directory, capture_output=True, text=True, timeout=90,
                                     env={**os.environ, 'NPM_CONFIG_IGNORE_SCRIPTS': 'true', 'NO_COLOR': '1'})
            report = json.loads(process.stdout)
            counts = report.get('metadata', {}).get('vulnerabilities')
            if process.returncode not in (0, 1) or report.get('error') or not isinstance(counts, dict) or not all(isinstance(counts.get(k), int) for k in ('critical', 'high')):
                raise ValueError('Audit unavailable')
            findings = []
            for advisory in report.get('advisories', {}).values():
                if advisory.get('severity') == 'critical':
                    findings.append({'package': advisory.get('module_name'), 'severity': 'critical', 'title': advisory.get('title'),
                                     'url': advisory.get('url'), 'vulnerable': advisory.get('vulnerable_versions'),
                                     'patched': advisory.get('patched_versions'),
                                     'paths': [p for f in advisory.get('findings', []) for p in f.get('paths', [])],
                                     'versions': [f.get('version') for f in advisory.get('findings', [])]})
            for name, vulnerability in report.get('vulnerabilities', {}).items():
                for advisory in vulnerability.get('via', []):
                    if isinstance(advisory, dict) and advisory.get('severity') == 'critical':
                        findings.append({'package': name, 'severity': 'critical', 'title': advisory.get('title'),
                                         'url': advisory.get('url'), 'vulnerable': advisory.get('range'),
                                         'fixAvailable': vulnerability.get('fixAvailable'), 'nodes': vulnerability.get('nodes', [])})
            entry.update(status='complete', counts=counts, critical=findings)
        except (ValueError, OSError, subprocess.TimeoutExpired):
            entry['reason'] = 'Audit tool or registry unavailable; no zero result claimed'
        results.append(entry)
result = {'repository': project, 'commit': sha, 'audits': results,
          'limits': 'Lockfile audit only; deployment and exposed functionality require independent evidence. No package install or project code executed.'}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'repository': project, 'commit': sha, 'audits': [{'lockfile': a['lockfile'], 'scope': a['scope'], 'status': a['status'], 'counts': a.get('counts')} for a in results]}))
if not results or any(a['status'] != 'complete' for a in results):
    raise SystemExit(1)
