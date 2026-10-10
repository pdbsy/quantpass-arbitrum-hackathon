"""Compare actual native compiler output without inferring absent qualification."""
import hashlib
import json
import sys
from pathlib import Path


def load(root):
    values = {}
    for file in sorted(root.rglob('*.json')):
        value = json.loads(file.read_text())
        if not isinstance(value, dict) or not all(
            key in value for key in ('abi', 'bytecode', 'deployedBytecode')
        ):
            continue
        creation = value['bytecode']['object'].removeprefix('0x')
        runtime = value['deployedBytecode']['object'].removeprefix('0x')
        metadata = value.get('metadata') or json.loads(value.get('rawMetadata', '{}'))
        settings = metadata.get('settings', {})
        # Interfaces legitimately have empty code and no compiler metadata.
        if (creation or runtime) and (
            metadata.get('compiler', {}).get('version') != '0.8.31+commit.fd3a2265'
            or settings.get('evmVersion') != 'paris'
            or settings.get('optimizer', {}).get('enabled') is not False
            or settings.get('viaIR', False) is not False
            or settings.get('metadata', {}).get('bytecodeHash') != 'none'
            or settings.get('metadata', {}).get('appendCBOR') is not False
        ):
            raise ValueError('Compiler settings not qualified: ' + str(file.relative_to(root)))
        values[str(file.relative_to(root))] = {
            'abi': value['abi'], 'creation': creation, 'runtime': runtime,
        }
    if not values:
        raise ValueError('No actual native compiler artifacts')
    return values


def compare(first, second):
    a, b = load(first), load(second)
    if a.keys() != b.keys():
        raise ValueError('Platform artifact set differs')
    for name in a:
        if a[name] != b[name]:
            raise ValueError('ABI/creation/runtime mismatch: ' + name)
    digest = hashlib.sha256(
        json.dumps(a, sort_keys=True, separators=(',', ':')).encode()
    ).hexdigest()
    return {
        'scope': 'ACTUAL_NATIVE_ARTIFACT_EQUALITY_NOT_CHAIN_DEPLOYMENT',
        'contracts': len(a), 'sha256': digest,
    }


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: compare_platform_artifacts.py DARWIN_OUT LINUX_OUT')
    print(json.dumps(compare(Path(sys.argv[1]), Path(sys.argv[2])), indent=2))
