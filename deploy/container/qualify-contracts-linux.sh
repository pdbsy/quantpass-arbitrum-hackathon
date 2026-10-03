#!/bin/bash
set -euo pipefail
# Qualification-only image. /reports is an isolated output mount, never live business data.
cd /src
set +e
bash contracts/script/check-phase1-contracts.sh
AF_QUALIFY_EXIT=$?
set -e
mkdir -p /reports
if [ -d .checks/af-chain01/out ]; then cp -R .checks/af-chain01/out /reports/out; fi
if [ -d .checks/af-chain01/evidence ]; then cp -R .checks/af-chain01/evidence /reports/evidence; fi
exit "$AF_QUALIFY_EXIT"
