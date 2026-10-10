from datetime import datetime, timezone
import hashlib
import copy
from pathlib import Path
import tempfile
import unittest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from slither_admissions import evaluate, AdmissionError


class SlitherAdmissionTests(unittest.TestCase):
    def scoped_fixture(self, root, element_type='function', check='timestamp'):
        file, report, review = self.fixture(root)
        (root / 'contracts/test').mkdir(parents=True)
        review.update(schemaVersion=2, approvalScope={'chainId': 46630, 'environment': 'ONCHAIN_TESTNET', 'mainnetAuthorized': False, 'authorization': 'RESIDUAL_RISK_ACCEPTANCE_ONLY'})
        entry = review['findings'][0]
        entry.update(elementType=element_type, check=check)
        finding = report['results']['detectors'][0]
        finding['check'] = check
        review['findingSourcePaths'] = {finding['id']: 'contracts/src/Fixture.sol'}
        element = finding['elements'][0]
        element['type'] = element_type
        if element_type == 'contract':
            element['name'] = 'Fixture'
            entry['function'] = 'Fixture'
        return file, report, review

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
        with self.assertRaises(AdmissionError):
            evaluate({'success': True, 'error': None, 'results': {}}, None, '.', execution_context={'chainId': 1, 'environment': 'MAINNET'})

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

    def test_scoped_risk_acceptance_never_grants_deployment_or_other_chain(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            _, report, review = self.scoped_fixture(root)
            context = {'chainId': 46630, 'environment': 'ONCHAIN_TESTNET'}
            before = copy.deepcopy(report)
            result = evaluate(report, review, root, execution_context=context)
            self.assertEqual(result['admitted'], 1)
            self.assertIs(result['deploymentAuthorized'], False)
            self.assertEqual(result['approvalScope'], review['approvalScope'])
            self.assertEqual(report, before)
            for change in ({'chainId': 1}, {'chainId': '46630'}, {'environment': 'MAINNET'}, {'mainnetAuthorized': True}, {'mainnetAuthorized': 0}, {'authorization': 'DEPLOYMENT'}, {'extraPermission': True}):
                with self.subTest(change=change):
                    mutated = copy.deepcopy(review)
                    mutated['approvalScope'].update(change)
                    with self.assertRaises(AdmissionError):
                        evaluate(report, mutated, root)
            for changed_scope in (None, {'chainId': 46630}):
                mutated = copy.deepcopy(review)
                mutated['approvalScope'] = changed_scope
                with self.assertRaises(AdmissionError):
                    evaluate(report, mutated, root)
            mutated = copy.deepcopy(review)
            del mutated['approvalScope']
            with self.assertRaises(AdmissionError):
                evaluate(report, mutated, root)
            for context in ({'chainId': 1, 'environment': 'ONCHAIN_TESTNET'}, {'chainId': 46630, 'environment': 'MAINNET'}, {'chainId': 46630, 'environment': 'ONCHAIN_TESTNET', 'extraPermission': True}):
                with self.assertRaises(AdmissionError):
                    evaluate(report, review, root, execution_context=context)

    def test_contract_element_requires_exact_type_name_source_and_detector(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            _, report, review = self.scoped_fixture(root, 'contract', 'missing-inheritance')
            self.assertEqual(evaluate(report, review, root)['admitted'], 1)
            for change in ({'function': 'OtherContract'}, {'elementType': 'function'}, {'elementType': 'event'}, {'elementType': None}, {'check': 'timestamp'}, {'reviewState': 'PENDING_USER'}):
                with self.subTest(change=change):
                    mutated = copy.deepcopy(review)
                    mutated['findings'][0].update(change)
                    with self.assertRaises(AdmissionError):
                        evaluate(report, mutated, root)
            for change in ({'name': 'OtherContract'}, {'type': 'function'}, {'source_mapping': {'filename_relative': 'src/Other.sol'}}):
                mutated = copy.deepcopy(report)
                mutated['results']['detectors'][0]['elements'][0].update(change)
                with self.assertRaises(AdmissionError):
                    evaluate(mutated, review, root)
            legacy = copy.deepcopy(review)
            legacy['schemaVersion'] = 1
            del legacy['approvalScope']
            with self.assertRaises(AdmissionError):
                evaluate(report, legacy, root)

    def test_scope_freezes_newly_added_source_and_test_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            _, report, review = self.scoped_fixture(root)
            self.assertEqual(evaluate(report, review, root)['admitted'], 1)
            (root / 'contracts/test/NewTest.sol').write_text('function test_other() {}\n')
            with self.assertRaisesRegex(AdmissionError, 'SLITHER_REVIEW_SOURCE_SET_CHANGED'):
                evaluate(report, review, root)

    def test_finding_cannot_move_to_another_already_bound_source(self):
        for element_type, check in (('function', 'timestamp'), ('contract', 'missing-inheritance')):
            with self.subTest(element_type=element_type), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                _, report, review = self.scoped_fixture(root, element_type, check)
                other_file = root / 'contracts/src/Other.sol'
                other_file.write_text('function test_other() {}\n')
                review['sourceHashes'].append({'path': 'contracts/src/Other.sol', 'sha256': hashlib.sha256(other_file.read_bytes()).hexdigest()})
                self.assertEqual(evaluate(report, review, root)['admitted'], 1)
                mutated_report = copy.deepcopy(report)
                mutated_report['results']['detectors'][0]['elements'][0]['source_mapping']['filename_relative'] = 'src/Other.sol'
                with self.assertRaisesRegex(AdmissionError, 'SLITHER_FINDING_CHANGED'):
                    evaluate(mutated_report, review, root)
                finding_id = report['results']['detectors'][0]['id']
                for source_map in ({}, {**review['findingSourcePaths'], 'b' * 64: 'contracts/src/Other.sol'}, {finding_id: 'contracts/src/NotReviewed.sol'}):
                    mutated_review = copy.deepcopy(review)
                    mutated_review['findingSourcePaths'] = source_map
                    with self.assertRaisesRegex(AdmissionError, 'SLITHER_FINDING_SOURCE_BINDING'):
                        evaluate(report, mutated_review, root)
