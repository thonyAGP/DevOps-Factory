"""Execute the shipped reporter contracts against public synthetic fixtures only."""
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import yaml

ROOT = Path(__file__).resolve().parents[1]


def step(template, name):
    document = yaml.safe_load((ROOT / 'templates' / template).read_text())
    return next(s['run'] for job in document['jobs'].values()
                for s in job['steps'] if s.get('name') == name)


def knip():
    run = step('dead-code-detection.yml', 'Run Knip')
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / 'package.json').write_text(json.dumps({'name': 'synthetic-contract', 'private': True}))
        (root / 'index.js').write_text('export const answer = 42;\n')
        output = root / 'outputs'
        result = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', run], cwd=root,
                                env={**os.environ, 'GITHUB_OUTPUT': str(output)}, timeout=180)
        if result.returncode or not output.exists():
            raise SystemExit('Knip reporter contract rejected the actual pinned CLI result')
        if 'has_issues=' not in output.read_text():
            raise SystemExit('Knip result was not classified')
        node = run.split("node <<'NODE'\n", 1)[1].split('\nNODE', 1)[0]
        Path('/tmp/knip-report.json').write_text('{"error":"synthetic tool failure"}')
        result = subprocess.run(['node', '-e', node], env={**os.environ, 'GITHUB_OUTPUT': str(output)},
                                capture_output=True, timeout=10)
        if result.returncode == 0:
            raise SystemExit('Tool failure was accepted as a dead-code result')
    print('Pinned Knip CLI result accepted; synthetic tool failure rejected.')


def a11y(case):
    run = step('accessibility-check.yml', 'Start server and run pa11y')
    run = run.replace('${{ steps.detect.outputs.framework }}', 'static')
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / 'dist').mkdir()
        body = '<main><h1>Fixture</h1><p>Readable page</p></main>'
        if case == 'violations':
            body = '<main><h1>Fixture</h1>' + '<button></button>' * 20 + '</main>'
        (root / 'dist' / 'index.html').write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Contract</title></head><body>' + body + '</body></html>')
        output = root / 'outputs'
        result = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', run], cwd=root,
                                env={**os.environ, 'GITHUB_OUTPUT': str(output)}, timeout=180)
        values = dict(line.split('=', 1) for line in output.read_text().splitlines()) if output.exists() else {}
        if 'violations' not in values:
            raise SystemExit('Pa11y results were lost before exit propagation')
        if case == 'clean' and (result.returncode or values['violations'] != '0'):
            raise SystemExit('Clean synthetic page rejected')
        if case == 'violations' and (result.returncode == 0 or int(values['violations']) <= 5):
            raise SystemExit('Above-threshold findings did not fail with a recorded result')
    print(f'Actual Pa11y CLI contract verified: {case}.')


if __name__ == '__main__':
    knip() if sys.argv[1] == 'knip' else a11y(sys.argv[1])
