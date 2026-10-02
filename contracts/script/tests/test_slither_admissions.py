from datetime import datetime, timezone
import hashlib
from pathlib import Path
import tempfile
import unittest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from slither_admissions import evaluate, AdmissionError


class SlitherAdmissionTests(unittest.TestCase):
    def fixture(self, root):
        file = root / 'contracts/src/Fixture.sol'
        file.parent.mkdir(parents=True)
        file.write_text('function test_attack() {}\n')
        finding = {'id': 'a' * 64, 'check': 'timestamp', 'impact': 'Low', 'confidence': 'Medium', 'elements': [{'type': 'function', 'name': 'execute', 'type_specific_fields': {'parent': {'name': 'Fixture'}}, 'source_mapping': {'filename_relative': 'src/Fixture.sol'}}]}
        report = {'success': True, 'error': None, 'results': {'detectors': [finding]}}
        entry = {key: finding[key] for key in ('id', 'check', 'impact', 'confidence')}
        entry.update(function='Fixture.execute', reviewState='APPROVED_BY_USER', rationale='Fixture only; not actual user approval.', evidence=['contracts/src/Fixture.sol#test_attack'])
        review = {'schemaVersion': 1, 'slitherVersion': '0.11.3', 'expiresAt': '2026-11-01T00:00:00Z', 'approvalRef': 'docs/specs/AF-TESTNET-SLITHER-REVIEW.md', 'sourceHashes': [{'path': 'contracts/src/Fixture.sol', 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}], 'findings': [entry]}
        return file, report, review

    def test_clean_report_needs_no_exception(self):
        self.assertEqual(evaluate({'success': True, 'error': None, 'results': {}}, None, '.'), {'findings': 0, 'admitted': 0, 'state': 'PASS'})

    def test_exact_fixture_only_and_raw_findings_remain(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            _, report, review = self.fixture(root)
            before = repr(report)
            self.assertEqual(evaluate(report, review, root)['admitted'], 1)
            self.assertEqual(repr(report), before)
            review['findings'][0]['reviewState'] = 'PENDING_USER'
            with self.assertRaises(AdmissionError):
                evaluate(report, review, root)

    def test_source_finding_evidence_and_expiry_drift_block(self):
        for change in ('source', 'finding', 'severity', 'evidence', 'expiry', 'analysis'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                file, report, review = self.fixture(root)
                if change == 'source': file.write_text('changed')
                if change == 'finding': report['results']['detectors'][0]['id'] = 'b' * 64
                if change == 'severity': report['results']['detectors'][0]['impact'] = 'High'
                if change == 'evidence': review['findings'][0]['evidence'] = ['contracts/src/Fixture.sol#not_a_test']
                if change == 'expiry': review['expiresAt'] = '2026-09-01T00:00:00Z'
                if change == 'analysis': report['success'] = False
                with self.assertRaises(AdmissionError):
                    evaluate(report, review, root, datetime(2026, 10, 2, tzinfo=timezone.utc))
