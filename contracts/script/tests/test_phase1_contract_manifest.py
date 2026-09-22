"""Regression tests for immutable-reference evidence in the Phase One manifest."""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_phase1_contract_manifest import _compiler_immutable_references


class Phase1ContractManifestTests(unittest.TestCase):
    def test_compiler_reference_ids_and_offsets_are_preserved(self):
        runtime = bytes(96)
        references = {
            '42': [{'start': 64, 'length': 32}],
            '7': [
                {'start': 0, 'length': 32},
                {'start': 32, 'length': 32},
            ],
        }

        self.assertEqual(
            _compiler_immutable_references(references, runtime),
            {
                'mappingStatus': 'COMPILER_REFERENCE_IDS_NOT_SOURCE_FIELD_MAPPED',
                'groups': [
                    {
                        'compilerReferenceId': '7',
                        'locations': [
                            {'start': 0, 'length': 32},
                            {'start': 32, 'length': 32},
                        ],
                    },
                    {
                        'compilerReferenceId': '42',
                        'locations': [{'start': 64, 'length': 32}],
                    },
                ],
            },
        )

    def test_out_of_bounds_reference_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'outside runtime template'):
            _compiler_immutable_references(
                {'7': [{'start': 48, 'length': 32}]},
                bytes(64),
            )

    def test_reference_must_point_to_zero_placeholder(self):
        runtime = bytes(31) + b'\x01' + bytes(32)
        with self.assertRaisesRegex(ValueError, 'nonzero runtime bytes'):
            _compiler_immutable_references(
                {'7': [{'start': 0, 'length': 32}]},
                runtime,
            )

    def test_overlapping_references_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'overlap'):
            _compiler_immutable_references(
                {
                    '7': [{'start': 0, 'length': 32}],
                    '42': [{'start': 16, 'length': 32}],
                },
                bytes(64),
            )


if __name__ == '__main__':
    unittest.main()
