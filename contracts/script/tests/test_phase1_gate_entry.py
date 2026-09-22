"""The Phase One rehearsal must resolve the contract project from any caller cwd."""

from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class Phase1GateEntryTests(unittest.TestCase):
    def test_rehearsal_runs_in_contract_project_from_any_caller(self):
        # Removing the gate's project-directory selection must fail this test.
        source = Path(__file__).resolve().parents[1] / 'check-phase1-contracts.sh'
        with tempfile.TemporaryDirectory(prefix='phase1 gate ') as directory:
            root = Path(directory).resolve()
            contracts = root / 'contracts'
            script = contracts / 'script'
            toolchain = root / '.checks/af-chain01/toolchain'
            script.mkdir(parents=True)
            (toolchain / 'bin').mkdir(parents=True)
            (toolchain / 'slither-venv/bin').mkdir(parents=True)
            shutil.copyfile(source, script / source.name)

            # The preceding full suite and manifest gate are independent of cwd
            # selection. Avoid recursively invoking them from their own unittest.
            (script / 'check-m3-vault.sh').write_text('#!/bin/bash\nexit 0\n')
            python = toolchain / 'slither-venv/bin/python'
            python.write_text('#!/bin/bash\nexit 0\n')
            python.chmod(0o755)

            # Observe the actual child-process directory at the Forge boundary;
            # this probe is not evidence of Solidity execution or compilation.
            forge = toolchain / 'bin/forge'
            forge.write_text('#!/bin/bash\nexec /bin/pwd -P\n')
            forge.chmod(0o755)
            unrelated = root / 'unrelated caller'
            unrelated.mkdir()

            for caller in (root, contracts, unrelated):
                with self.subTest(caller=caller.relative_to(root).as_posix()):
                    result = subprocess.run(
                        ['/bin/bash', str(script / source.name)],
                        cwd=caller,
                        env={'PATH': '/usr/bin:/bin'},
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(
                        Path(result.stdout.strip()).relative_to(root).as_posix(), 'contracts',
                        'rehearsal selected the caller directory instead of contracts',
                    )


if __name__ == '__main__':
    unittest.main()
