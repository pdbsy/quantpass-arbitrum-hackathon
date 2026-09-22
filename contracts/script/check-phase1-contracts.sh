#!/bin/bash
set -euo pipefail

if [ "$#" -ne 0 ]; then
  echo 'check-phase1-contracts.sh accepts no arguments' >&2
  exit 2
fi

CONTRACT_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$CONTRACT_ROOT"
TASK_PYTHON="$CONTRACT_ROOT/../.checks/af-chain01/toolchain/slither-venv/bin/python"
TOOLCHAIN_BIN="$CONTRACT_ROOT/../.checks/af-chain01/toolchain/bin"
ARTIFACT_ROOT="$CONTRACT_ROOT/../.checks/af-chain01/out"

/bin/bash "$CONTRACT_ROOT/script/check-m3-vault.sh"

env -i PATH=/usr/bin:/bin PYTHONNOUSERSITE=1 "$TASK_PYTHON" \
  "$CONTRACT_ROOT/script/build_phase1_contract_manifest.py" \
  --artifact-root "$ARTIFACT_ROOT" \
  --output "$CONTRACT_ROOT/deployment/phase1-contract-artifacts.json" \
  --check

env -i \
  PATH="$TOOLCHAIN_BIN:/usr/bin:/bin" \
  FOUNDRY_PROFILE=default \
  SVM_HOME="$CONTRACT_ROOT/../.checks/af-chain01/toolchain/svm" \
  FOUNDRY_DIR="$CONTRACT_ROOT/../.checks/af-chain01/toolchain/foundry" \
  forge test --offline --match-path 'test/Phase1DeploymentRehearsal.t.sol'
