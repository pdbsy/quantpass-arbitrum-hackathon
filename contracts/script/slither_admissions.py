"""Exact user-reviewed findings only; retain the scanner's unmodified raw report."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


class AdmissionError(ValueError):
    pass


def evaluate(report, review, root, now=None, execution_context=None):
    now = now or datetime.now(timezone.utc)
    if not isinstance(report, dict) or report.get('success') is not True or report.get('error') is not None or not isinstance(report.get('results'), dict):
        raise AdmissionError('SLITHER_ANALYSIS_FAILED')
    findings = report['results'].get('detectors', [])
    if not isinstance(findings, list):
        raise AdmissionError('SLITHER_REPORT_SHAPE')
    if not findings and execution_context is None:
        return {'findings': 0, 'admitted': 0, 'state': 'PASS'}
    keys = {'schemaVersion', 'slitherVersion', 'expiresAt', 'approvalRef', 'sourceHashes', 'findings'}
    version = review.get('schemaVersion') if isinstance(review, dict) else None
    if version == 2:
        keys.update(('approvalScope', 'findingSourcePaths'))
    if not isinstance(review, dict) or set(review) != keys or type(version) is not int or version not in (1, 2) or review['slitherVersion'] != '0.11.3' or review['approvalRef'] != 'docs/specs/AF-TESTNET-SLITHER-REVIEW.md':
        raise AdmissionError('SLITHER_REVIEW_SHAPE')
    # Static admission never grants deployment/signing/funding authority. A future
    # execution consumer must also pass its observed chain and environment here.
    scope = {'chainId': 46630, 'environment': 'ONCHAIN_TESTNET', 'mainnetAuthorized': False, 'authorization': 'RESIDUAL_RISK_ACCEPTANCE_ONLY'}
    if version == 2 and (review['approvalScope'] != scope or type(review['approvalScope'].get('chainId')) is not int or review['approvalScope'].get('mainnetAuthorized') is not False):
        raise AdmissionError('SLITHER_APPROVAL_SCOPE')
    if execution_context is not None and (version != 2 or execution_context != {'chainId': 46630, 'environment': 'ONCHAIN_TESTNET'} or type(execution_context.get('chainId')) is not int):
        raise AdmissionError('SLITHER_EXECUTION_SCOPE')
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
    if version == 2:
        current_sources = set()
        for directory in ('contracts/src', 'contracts/test'):
            base = root / directory
            if not base.is_dir() or base.is_symlink():
                raise AdmissionError('SLITHER_REVIEW_SOURCE')
            for path in base.rglob('*'):
                if path.is_symlink():
                    raise AdmissionError('SLITHER_REVIEW_SOURCE')
                if path.is_file() and path.suffix == '.sol':
                    current_sources.add(path.relative_to(root).as_posix())
        if current_sources != seen:
            raise AdmissionError('SLITHER_REVIEW_SOURCE_SET_CHANGED')
    admissions = review['findings']
    if not isinstance(admissions, list) or len(admissions) != len(findings):
        raise AdmissionError('SLITHER_FINDINGS_CHANGED')
    expected = {}
    for entry in admissions:
        entry_keys = {'id', 'check', 'impact', 'confidence', 'function', 'reviewState', 'rationale', 'evidence'}
        if version == 2 and isinstance(entry, dict) and 'elementType' in entry:
            entry_keys.add('elementType')
        if not isinstance(entry, dict) or set(entry) != entry_keys or entry['id'] in expected or entry['reviewState'] != 'APPROVED_BY_USER':
            raise AdmissionError('SLITHER_USER_APPROVAL_REQUIRED')
        element_type = entry.get('elementType', 'function')
        if element_type not in ('function', 'contract') or (element_type == 'contract' and entry['check'] != 'missing-inheritance'):
            raise AdmissionError('SLITHER_FINDING_CHANGED')
        if not isinstance(entry['rationale'], str) or not 1 <= len(entry['rationale']) <= 2000 or not isinstance(entry['evidence'], list) or not entry['evidence']:
            raise AdmissionError('SLITHER_REVIEW_EVIDENCE')
        for evidence in entry['evidence']:
            if not isinstance(evidence, str) or evidence.count('#') != 1:
                raise AdmissionError('SLITHER_REVIEW_EVIDENCE')
            filename, function = evidence.split('#')
            if filename not in seen or not function or f'function {function}(' not in (root / filename).read_text():
                raise AdmissionError('SLITHER_REVIEW_EVIDENCE')
        expected[entry['id']] = entry
    if version == 2:
        finding_sources = review['findingSourcePaths']
        if not isinstance(finding_sources, dict) or set(finding_sources) != set(expected) or any(not isinstance(path, str) or path not in seen for path in finding_sources.values()):
            raise AdmissionError('SLITHER_FINDING_SOURCE_BINDING')
    observed = set()
    for finding in findings:
        if not isinstance(finding, dict) or finding.get('id') not in expected or finding['id'] in observed:
            raise AdmissionError('SLITHER_UNREVIEWED_FINDING')
        entry = expected[finding['id']]
        if any(finding.get(key) != entry[key] for key in ('check', 'impact', 'confidence')):
            raise AdmissionError('SLITHER_FINDING_CHANGED')
        element_type = entry.get('elementType', 'function')
        elements = [e for e in finding.get('elements', []) if e.get('type') == element_type]
        if not elements:
            raise AdmissionError('SLITHER_FINDING_CHANGED')
        first = elements[0]
        parent = first.get('type_specific_fields', {}).get('parent', {}).get('name')
        identity = f"{parent}.{first.get('name')}" if element_type == 'function' else first.get('name')
        source_path = 'contracts/' + first.get('source_mapping', {}).get('filename_relative', '')
        if identity != entry['function'] or source_path not in seen or (version == 2 and finding_sources[finding['id']] != source_path):
            raise AdmissionError('SLITHER_FINDING_CHANGED')
        observed.add(finding['id'])
    result = {'findings': len(findings), 'admitted': len(observed), 'state': 'PASS'}
    if version == 2:
        result.update(approvalScope=scope, deploymentAuthorized=False)
    return result


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
