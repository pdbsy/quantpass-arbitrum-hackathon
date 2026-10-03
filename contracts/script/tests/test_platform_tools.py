import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bootstrap import select_lock


class PlatformTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).resolve().parents[2] / 'toolchain.lock.json'
        self.lock = json.loads(path.read_text())

    def test_linux_selects_native_artifacts_and_binary_wheel_lock(self):
        value = select_lock(self.lock, 'Linux', 'x86_64', (3, 12, 9))
        self.assertIn('forge-linux-amd64', value['foundry']['filename'])
        self.assertIn('linux-amd64', value['solc']['url'])
        self.assertEqual(value['slither']['requirements'], 'requirements-slither-linux-x64.lock')

    def test_darwin_preserves_original_artifacts(self):
        value = select_lock(self.lock, 'Darwin', 'arm64', (3, 12, 9))
        self.assertEqual(value['foundry'], self.lock['foundry'])

    def test_python_patch_and_unsupported_platform_rejected(self):
        for system, machine, version in [
            ('Linux', 'aarch64', (3, 12, 9)),
            ('Darwin', 'x86_64', (3, 12, 9)),
            ('Linux', 'x86_64', (3, 12, 0)),
        ]:
            with self.assertRaises(ValueError):
                select_lock(self.lock, system, machine, version)
