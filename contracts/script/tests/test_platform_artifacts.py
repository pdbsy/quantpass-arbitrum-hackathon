import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from compare_platform_artifacts import compare


class ArtifactTests(unittest.TestCase):
    def test_real_artifact_contract_checks_abi_and_both_bytecodes(self):
        with tempfile.TemporaryDirectory() as folder:
            a, b = Path(folder) / 'a', Path(folder) / 'b'
            a.mkdir()
            b.mkdir()
            value = {
                'abi': [{'type': 'function', 'name': 'owner', 'inputs': []}],
                'bytecode': {'object': '0x6001'},
                'deployedBytecode': {'object': '0x6002'},
                'metadata': {
                    'compiler': {'version': '0.8.31+commit.fd3a2265'},
                    'settings': {
                        'evmVersion': 'paris', 'optimizer': {'enabled': False},
                        'metadata': {'bytecodeHash': 'none', 'appendCBOR': False},
                    },
                },
            }
            for directory in (a, b):
                (directory / 'Vault.json').write_text(json.dumps(value))
            self.assertEqual(compare(a, b)['contracts'], 1)
            for field in ['abi', 'bytecode', 'deployedBytecode']:
                changed = json.loads(json.dumps(value))
                changed[field] = [] if field == 'abi' else {'object': '0x6003'}
                (b / 'Vault.json').write_text(json.dumps(changed))
                with self.assertRaises(ValueError):
                    compare(a, b)
            value['metadata']['settings']['optimizer']['enabled'] = True
            (b / 'Vault.json').write_text(json.dumps(value))
            with self.assertRaises(ValueError):
                compare(a, b)

    def test_empty_directories_never_claim_equivalence(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):
                compare(Path(folder), Path(folder))

    def test_empty_interface_bytecode_has_no_metadata_but_abi_is_compared(self):
        with tempfile.TemporaryDirectory() as folder:
            a, b = Path(folder) / 'a', Path(folder) / 'b'
            a.mkdir()
            b.mkdir()
            value = {
                'abi': [{'name': 'owner', 'type': 'function'}],
                'bytecode': {'object': '0x'}, 'deployedBytecode': {'object': '0x'},
            }
            for directory in (a, b):
                (directory / 'Interface.json').write_text(json.dumps(value))
            self.assertEqual(compare(a, b)['contracts'], 1)
