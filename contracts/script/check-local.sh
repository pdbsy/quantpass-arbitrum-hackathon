#!/bin/bash
set -euo pipefail
if [ "$#" -ne 0 ]; then
  echo 'check-local.sh accepts no arguments' >&2
  exit 2
fi
CONTRACT_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$CONTRACT_ROOT"
TASK_PYTHON="$CONTRACT_ROOT/../.checks/af-chain01/toolchain/slither-venv/bin/python"
# A clean child environment prevents caller Forge profile/RPC overrides from changing these checks.
if [ "${AF_CHAIN01_CLEAN_ENV:-}" != 1 ]; then
  exec env -i AF_CHAIN01_CLEAN_ENV=1 PATH="$CONTRACT_ROOT/../.checks/af-chain01/toolchain/bin:$CONTRACT_ROOT/../.checks/af-chain01/toolchain/slither-venv/bin:/usr/bin:/bin" FOUNDRY_PROFILE=default SVM_HOME="$CONTRACT_ROOT/../.checks/af-chain01/toolchain/svm" FOUNDRY_DIR="$CONTRACT_ROOT/../.checks/af-chain01/toolchain/foundry" /bin/bash "$CONTRACT_ROOT/script/check-local.sh"
fi
"$TASK_PYTHON" - <<'PY'
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys
import tarfile
sys.path.insert(0, str(Path('script').resolve()))
from bootstrap import verify
lock = json.loads(Path('toolchain.lock.json').read_text())
for name in ('foundry', 'solc', 'openzeppelin'):
    verify(Path('../.checks/af-chain01/toolchain/downloads') / lock[name]['filename'], lock[name])
with tarfile.open(Path('../.checks/af-chain01/toolchain/downloads') / lock['foundry']['filename']) as archive:
    if archive.extractfile('package/bin/forge').read() != Path('../.checks/af-chain01/toolchain/bin/forge').read_bytes():
        raise SystemExit('Installed Forge binary differs from verified archive')
if hashlib.sha256(Path('../.checks/af-chain01/toolchain/bin/solc').read_bytes()).hexdigest() != lock['solc']['sha256']:
    raise SystemExit('Installed solc differs from verified artifact')
with tarfile.open(Path('../.checks/af-chain01/toolchain/downloads') / lock['openzeppelin']['filename']) as archive:
    for member in archive.getmembers():
        if member.isfile():
            installed = Path('node_modules/@openzeppelin/contracts') / member.name.removeprefix('package/')
            if not installed.is_file() or archive.extractfile(member).read() != installed.read_bytes():
                raise SystemExit('Installed OpenZeppelin content mismatch: ' + member.name)
if hashlib.sha256(Path('requirements-slither.lock').read_bytes()).hexdigest() != lock['slither']['requirementsSha256']:
    raise SystemExit('Slither lock mismatch')
for line in Path('requirements-slither.lock').read_text().splitlines():
    if line and not line.startswith('#'):
        name, version = line.split()[0].split('==')
        if importlib.metadata.version(name) != version:
            raise SystemExit('Installed dependency version mismatch: ' + name)
forge = subprocess.check_output(['forge', '--version'], text=True)
solc = subprocess.check_output(['solc', '--version'], text=True)
if 'Version: 1.5.1-v1.5.1' not in forge or lock['foundry']['commit'] not in forge:
    raise SystemExit('Forge version mismatch')
if lock['solc']['longVersion'] not in solc:
    raise SystemExit('solc version mismatch')
print(forge.strip())
print(solc.strip())
print('Slither ' + importlib.metadata.version('slither-analyzer'))
PY
mkdir -p ../.checks/af-chain01/evidence
forge fmt --check
forge build --offline
forge test --offline
# Fail on any finding. Do not suppress findings to manufacture a clean result.
slither . --compile-force-framework foundry --exclude-dependencies --fail-pedantic --foundry-out-directory ../.checks/af-chain01/out --json - > ../.checks/af-chain01/evidence/slither.json
