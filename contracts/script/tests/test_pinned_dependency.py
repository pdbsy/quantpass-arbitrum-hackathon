"""Regression tests for the exact pragma-only dependency derivation."""
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pinned_dependency import derive_source, materialize, verify_equivalence

ORIGINAL = b'// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\nlibrary Example {}\n'
EXPECTED = b'// SPDX-License-Identifier: MIT\npragma solidity 0.8.31;\nlibrary Example {}\n'
ENTRY = {
    'path': 'utils/Example.sol',
    'pragma': 'pragma solidity ^0.8.20;',
    'originalSha256': hashlib.sha256(ORIGINAL).hexdigest(),
    'derivedSha256': hashlib.sha256(EXPECTED).hexdigest(),
}


class PinnedDependencyTests(unittest.TestCase):
    def test_empty_compilation_cannot_claim_equivalence(self):
        with self.assertRaisesRegex(ValueError, 'Empty compilation'):
            verify_equivalence({}, {})

    def test_changed_compilation_is_rejected(self):
        for field in ('abi', 'creation', 'runtime'):
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'differs'):
                verify_equivalence({field: 'original'}, {field: 'changed'})

    def test_identical_nonempty_compilation_is_accepted(self):
        self.assertIsNone(verify_equivalence({'runtime': '6000'}, {'runtime': '6000'}))

    def test_derivation_preserves_every_non_pragma_byte(self):
        self.assertEqual(derive_source(ORIGINAL, ENTRY), EXPECTED)

    def test_source_drift_is_rejected_before_derivation(self):
        with self.assertRaisesRegex(ValueError, 'Original checksum'):
            derive_source(ORIGINAL.replace(b'Example', b'Other'), ENTRY)

    def test_unexpected_derived_hash_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Derived checksum'):
            derive_source(ORIGINAL, {**ENTRY, 'derivedSha256': '0' * 64})

    def test_only_reviewed_compatible_pragma_can_be_narrowed(self):
        source = ORIGINAL.replace(b'^0.8.20', b'^0.9.0')
        entry = {**ENTRY, 'pragma': 'pragma solidity ^0.9.0;',
                 'originalSha256': hashlib.sha256(source).hexdigest()}
        with self.assertRaisesRegex(ValueError, 'Unsupported pragma'):
            derive_source(source, entry)

    def test_materialization_preserves_original_and_license_and_is_repeatable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            upstream, target = root / 'original', root / 'derived'
            (upstream / 'utils').mkdir(parents=True)
            (upstream / ENTRY['path']).write_bytes(ORIGINAL)
            license_data = b'MIT license fixture\n'
            (upstream / 'LICENSE').write_bytes(license_data)
            materialize(upstream, target, [ENTRY], (upstream / 'LICENSE').read_bytes())
            materialize(upstream, target, [ENTRY], (upstream / 'LICENSE').read_bytes())
            self.assertEqual((target / ENTRY['path']).read_bytes(), EXPECTED)
            self.assertEqual((upstream / ENTRY['path']).read_bytes(), ORIGINAL)
            self.assertEqual((target / 'LICENSE').read_bytes(), license_data)
            (target / ENTRY['path']).write_bytes(EXPECTED + b'// changed\n')
            with self.assertRaisesRegex(ValueError, 'Derived tree drift'):
                materialize(upstream, target, [ENTRY], (upstream / 'LICENSE').read_bytes())

    def test_extra_files_and_symlinks_are_rejected(self):
        for mode in ('extra', 'symlink'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp).resolve()
                upstream, target = root / 'original', root / 'derived'
                (upstream / 'utils').mkdir(parents=True)
                (upstream / ENTRY['path']).write_bytes(ORIGINAL)
                (upstream / 'LICENSE').write_bytes(b'MIT\n')
                materialize(upstream, target, [ENTRY], (upstream / 'LICENSE').read_bytes())
                if mode == 'extra':
                    (target / 'extra.sol').write_bytes(b'changed')
                else:
                    (target / ENTRY['path']).unlink()
                    (target / ENTRY['path']).symlink_to(upstream / ENTRY['path'])
                with self.assertRaises(ValueError):
                    materialize(upstream, target, [ENTRY], (upstream / 'LICENSE').read_bytes())

    def test_manifest_cannot_escape_destination(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, 'Unsafe manifest path'):
                materialize(Path(tmp), Path(tmp) / 'derived', [{**ENTRY, 'path': '../outside.sol'}], b'MIT')


if __name__ == '__main__':
    unittest.main()
