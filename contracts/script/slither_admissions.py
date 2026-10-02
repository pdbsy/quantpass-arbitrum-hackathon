"""Exact user-reviewed findings only; retain the scanner's unmodified raw report."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


class AdmissionError(ValueError):
    pass


def evaluate(report, review, root, now=None):
    now = now or datetime.now(timezone.utc)
    if not isinstance(report, dict) or report.get('success') is not True or report.get('error') is not None or not isinstance(report.get('results'), dict):
        raise AdmissionError('SLITHER_ANALYSIS_FAILED')
    findings = report['results'].get('detectors', [])
    if not isinstance(findings, list):
        raise AdmissionError('SLITHER_REPORT_SHAPE')
    if not findings:
        return {'findings': 0, 'admitted': 0, 'state': 'PASS'}
    keys = {'schemaVersion', 'slitherVersion', 'expiresAt', 'approvalRef', 'sourceHashes', 'findings'}
    if not isinstance(review, dict) or set(review) != keys or review['schemaVersion'] != 1 or review['slitherVersion'] != '0.11.3' or review['approvalRef'] != 'docs/specs/AF-TESTNET-SLITHER-REVIEW.md':
        raise AdmissionError('SLITHER_REVIEW_SHAPE')
    if datetime.fromisoformat(review['expiresAt']) <= now:
        raise AdmissionError('SLITHER_REVIEW_EXPIRED')
    root = Path(root).resolve()
    sources = review['sourceHashes']
    if not isinstance(sources, list) or not sources:
        raise AdmissionError('SLITHER_REVIEW_SOURCE')
    seen = set()
    for source in sources:
        if not isinstance(source, dict) or set(source) != {'path', 'sha256'}:
            raise AdmissionError('SLITHER_REVIEW_SOURCE')
        name = source['path']
        if not isinstance(name, str) or not name.endswith('.sol') or not name.startswith(('contracts/src/', 'contracts/test/')) or name in seen:
            raise AdmissionError('SLITHER_REVIEW_SOURCE')
        path = root / name
        if path.resolve() != path or not path.is_file() or path.stat().st_nlink != 1 or path.stat().st_size > 2 * 1024 * 1024 or hashlib.sha256(path.read_bytes()).hexdigest() != source['sha256']:
            raise AdmissionError('SLITHER_REVIEW_SOURCE_CHANGED')
        seen.add(name)
    admissions = review['findings']
    if not isinstance(admissions, list) or len(admissions) != len(findings):
        raise AdmissionError('SLITHER_FINDINGS_CHANGED')
    expected = {}
    for entry in admissions:
        if not isinstance(entry, dict) or set(entry) != {'id', 'check', 'impact', 'confidence', 'function', 'reviewState', 'rationale', 'evidence'} or entry['id'] in expected or entry['reviewState'] != 'APPROVED_BY_USER':
            raise AdmissionError('SLITHER_USER_APPROVAL_REQUIRED')
        if not isinstance(entry['rationale'], str) or not 1 <= len(entry['rationale']) <= 2000 or not isinstance(entry['evidence'], list) or not entry['evidence']:
            raise AdmissionError('SLITHER_REVIEW_EVIDENCE')
        for evidence in entry['evidence']:
            if not isinstance(evidence, str) or evidence.count('#') != 1:
                raise AdmissionError('SLITHER_REVIEW_EVIDENCE')
            filename, function = evidence.split('#')
            if filename not in seen or not function or f'function {function}(' not in (root / filename).read_text():
                raise AdmissionError('SLITHER_REVIEW_EVIDENCE')
        expected[entry['id']] = entry
    observed = set()
    for finding in findings:
        if not isinstance(finding, dict) or finding.get('id') not in expected or finding['id'] in observed:
            raise AdmissionError('SLITHER_UNREVIEWED_FINDING')
        entry = expected[finding['id']]
        if any(finding.get(key) != entry[key] for key in ('check', 'impact', 'confidence')):
            raise AdmissionError('SLITHER_FINDING_CHANGED')
        functions = [e for e in finding.get('elements', []) if e.get('type') == 'function']
        if not functions:
            raise AdmissionError('SLITHER_FINDING_CHANGED')
        first = functions[0]
        parent = first.get('type_specific_fields', {}).get('parent', {}).get('name')
        if f"{parent}.{first.get('name')}" != entry['function'] or 'contracts/' + first.get('source_mapping', {}).get('filename_relative', '') not in seen:
            raise AdmissionError('SLITHER_FINDING_CHANGED')
        observed.add(finding['id'])
    return {'findings': len(findings), 'admitted': len(observed), 'state': 'PASS'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--review', required=True, type=Path)
    parser.add_argument('--root', required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.report.stat().st_size > 16 * 1024 * 1024 or args.review.stat().st_size > 256 * 1024:
            raise AdmissionError('SLITHER_REPORT_SIZE')
        report = json.loads(args.report.read_text())
        review = json.loads(args.review.read_text()) if args.review.is_file() else None
        print(json.dumps(evaluate(report, review, args.root)))
    except (AdmissionError, ValueError, OSError, KeyError, TypeError):
        print('SLITHER_ADMISSION_BLOCKED')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
