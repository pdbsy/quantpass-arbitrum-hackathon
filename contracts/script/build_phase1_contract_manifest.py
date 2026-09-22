"""Build or verify the deterministic Phase One contract artifact manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

from eth_utils import keccak


CONTRACTS = (
    ('StrategyPass', 'src/StrategyPass.sol', 'StrategyPass.sol/StrategyPass.json'),
    (
        'AlphaForgeTestUSDC',
        'src/AlphaForgeTestAsset.sol',
        'AlphaForgeTestAsset.sol/AlphaForgeTestUSDC.json',
    ),
    (
        'AlphaForgeTestETH',
        'src/AlphaForgeTestAsset.sol',
        'AlphaForgeTestAsset.sol/AlphaForgeTestETH.json',
    ),
    (
        'AlphaForgeTestBTC',
        'src/AlphaForgeTestAsset.sol',
        'AlphaForgeTestAsset.sol/AlphaForgeTestBTC.json',
    ),
    (
        'AlphaForgeTestVenue',
        'src/AlphaForgeTestVenue.sol',
        'AlphaForgeTestVenue.sol/AlphaForgeTestVenue.json',
    ),
    (
        'AlphaForgeSwapAdapter',
        'src/AlphaForgeSwapAdapter.sol',
        'AlphaForgeSwapAdapter.sol/AlphaForgeSwapAdapter.json',
    ),
    ('AlphaForgeVault', 'src/AlphaForgeVault.sol', 'AlphaForgeVault.sol/AlphaForgeVault.json'),
    ('PassLocker', 'src/PassLocker.sol', 'PassLocker.sol/PassLocker.json'),
)

DECLARED_IMMUTABLES = {
    'StrategyPass': (
        ('strategyId', 'bytes32'),
    ),
    'AlphaForgeTestUSDC': (),
    'AlphaForgeTestETH': (),
    'AlphaForgeTestBTC': (),
    'AlphaForgeTestVenue': (
        ('afUsdc', 'address'),
        ('afEth', 'address'),
        ('afBtc', 'address'),
    ),
    'AlphaForgeSwapAdapter': (
        ('venue', 'ITestVenue'),
        ('afUsdc', 'address'),
        ('afEth', 'address'),
        ('afBtc', 'address'),
    ),
    'AlphaForgeVault': (
        ('owner', 'address'),
        ('strategyCreator', 'address'),
        ('strategyId', 'bytes32'),
        ('strategyRef', 'bytes32'),
        ('pass', 'address'),
        ('afUsdc', 'address'),
        ('afEth', 'address'),
        ('afBtc', 'address'),
        ('passLocker', 'address'),
    ),
    'PassLocker': (
        ('vault', 'address'),
        ('owner', 'address'),
        ('pass', 'IERC20'),
    ),
}


def _canonical_json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def _keccak_bytes(value: bytes) -> str:
    return '0x' + keccak(value).hex()


def _canonical_type(entry: dict) -> str:
    type_name = entry['type']
    if not type_name.startswith('tuple'):
        return type_name
    suffix = type_name[len('tuple'):]
    components = ','.join(_canonical_type(component) for component in entry['components'])
    return f'({components}){suffix}'


def _signature(entry: dict) -> str:
    inputs = ','.join(_canonical_type(value) for value in entry.get('inputs', []))
    return f"{entry['name']}({inputs})"


def _compiler_immutable_references(references: object, runtime_template: bytes) -> dict:
    if not isinstance(references, dict):
        raise ValueError('Compiler immutable references must be an object')

    groups = []
    occupied = []
    for reference_id, raw_locations in references.items():
        if not isinstance(reference_id, str) or not reference_id.isdecimal():
            raise ValueError('Compiler immutable reference ID must be a decimal string')
        if not isinstance(raw_locations, list) or not raw_locations:
            raise ValueError(f'Compiler immutable reference {reference_id} has no locations')

        locations = []
        for raw_location in raw_locations:
            if not isinstance(raw_location, dict):
                raise ValueError(f'Compiler immutable reference {reference_id} location is invalid')
            start = raw_location.get('start')
            length = raw_location.get('length')
            if type(start) is not int or start < 0 or type(length) is not int or length <= 0:
                raise ValueError(f'Compiler immutable reference {reference_id} location is invalid')
            end = start + length
            if end > len(runtime_template):
                raise ValueError(
                    f'Compiler immutable reference {reference_id} is outside runtime template'
                )
            if any(runtime_template[start:end]):
                raise ValueError(
                    f'Compiler immutable reference {reference_id} points to nonzero runtime bytes'
                )
            occupied.append((start, end, reference_id))
            locations.append({'start': start, 'length': length})

        groups.append(
            {
                'compilerReferenceId': reference_id,
                'locations': sorted(locations, key=lambda value: (value['start'], value['length'])),
            }
        )

    occupied.sort()
    for previous, current in zip(occupied, occupied[1:]):
        if current[0] < previous[1]:
            raise ValueError(
                'Compiler immutable references overlap: '
                f'{previous[2]}@{previous[0]} and {current[2]}@{current[0]}'
            )

    return {
        'mappingStatus': 'COMPILER_REFERENCE_IDS_NOT_SOURCE_FIELD_MAPPED',
        'groups': sorted(groups, key=lambda value: int(value['compilerReferenceId'])),
    }


def _state_immutables(name: str, artifact: dict, source_text: str) -> list[dict]:
    declarations = DECLARED_IMMUTABLES[name]
    observed = tuple(
        (match.group('name'), match.group('type'))
        for match in re.finditer(
            r'^\s*(?P<type>[A-Za-z_][A-Za-z0-9_.]*)\s+public\s+immutable'
            r'(?:\s+override)?\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*;',
            source_text,
            re.MULTILINE,
        )
    )
    if tuple(sorted(observed)) != tuple(sorted(declarations)):
        raise ValueError(f'{name} immutable declarations changed')
    references = artifact['deployedBytecode'].get('immutableReferences', {})
    if len(references) != len(declarations):
        raise ValueError(
            f'{name} immutable group count changed: {len(references)} != {len(declarations)}'
        )
    return [{'name': immutable, 'type': type_name} for immutable, type_name in declarations]


def _constructor(abi: list[dict]) -> list[dict]:
    constructors = [entry for entry in abi if entry.get('type') == 'constructor']
    if len(constructors) > 1:
        raise ValueError('artifact has more than one constructor')
    if not constructors:
        return []
    return [
        {'name': value.get('name', ''), 'type': _canonical_type(value)}
        for value in constructors[0].get('inputs', [])
    ]


def _events(abi: list[dict]) -> list[dict]:
    result = []
    for entry in abi:
        if entry.get('type') != 'event':
            continue
        signature = _signature(entry)
        result.append(
            {
                'signature': signature,
                'topic0': _keccak_bytes(signature.encode()),
                'indexedMask': ''.join(
                    '1' if value.get('indexed', False) else '0'
                    for value in entry.get('inputs', [])
                ),
            }
        )
    return sorted(result, key=lambda value: value['signature'])


def _errors(abi: list[dict]) -> list[dict]:
    result = []
    for entry in abi:
        if entry.get('type') != 'error':
            continue
        signature = _signature(entry)
        result.append(
            {
                'signature': signature,
                'selector': _keccak_bytes(signature.encode())[:10],
            }
        )
    return sorted(result, key=lambda value: value['signature'])


def _contract_entry(
    contract_root: Path,
    artifact_root: Path,
    name: str,
    source_path: str,
    artifact_path: str,
) -> dict:
    source = contract_root / source_path
    source_bytes = source.read_bytes()
    source_text = source_bytes.decode()
    artifact_file = artifact_root / artifact_path
    artifact = json.loads(artifact_file.read_text())
    abi = artifact['abi']
    creation = bytes.fromhex(artifact['bytecode']['object'].removeprefix('0x'))
    runtime_template = bytes.fromhex(
        artifact['deployedBytecode']['object'].removeprefix('0x')
    )
    immutable_references = _compiler_immutable_references(
        artifact['deployedBytecode'].get('immutableReferences', {}),
        runtime_template,
    )
    methods = {
        signature: '0x' + selector
        for signature, selector in sorted(artifact['methodIdentifiers'].items())
    }
    return {
        'source': source_path,
        'sourceSha256': hashlib.sha256(source_bytes).hexdigest(),
        'artifact': artifact_path,
        'constructor': _constructor(abi),
        'immutables': _state_immutables(name, artifact, source_text),
        'compilerImmutableReferences': immutable_references,
        'immutableReferenceGroupCount': len(immutable_references['groups']),
        'methodIdentifiers': methods,
        'events': _events(abi),
        'errors': _errors(abi),
        'abiKeccak256': _keccak_bytes(_canonical_json(abi)),
        'creationBytecode': {
            'lengthBytes': len(creation),
            'keccak256': _keccak_bytes(creation),
        },
        'compilerRuntimeTemplate': {
            'lengthBytes': len(runtime_template),
            'keccak256': _keccak_bytes(runtime_template),
            'note': 'Immutable slots are compiler placeholders; deployed runtime is verified separately.',
        },
        'deployedAddress': None,
        'deployedRuntimeKeccak256': None,
    }


def build_manifest(contract_root: Path, artifact_root: Path) -> dict:
    lock = json.loads((contract_root / 'toolchain.lock.json').read_text())
    return {
        'schemaVersion': 2,
        'status': 'LOCAL_COMPILED_NOT_DEPLOYED',
        'networkTarget': {
            'name': 'Robinhood Chain Testnet',
            'chainId': 46630,
            'externalWritePerformed': False,
        },
        'toolchain': {
            'foundry': lock['foundry']['version'],
            'foundryCommit': lock['foundry']['commit'],
            'solc': lock['solc']['longVersion'],
            'openzeppelinContracts': lock['openzeppelin']['version'],
            **lock['compilerSettings'],
            'bytecodeHash': 'none',
            'cborMetadata': False,
        },
        'contracts': {
            name: _contract_entry(contract_root, artifact_root, name, source, artifact)
            for name, source, artifact in CONTRACTS
        },
        'limitations': [
            'No external RPC, key, signature, deployment, transaction, broadcast or finality evidence.',
            'Compiler runtime template hashes contain zeroed immutable placeholders and are not deployed runtime hashes.',
            'Compiler immutable reference IDs and offsets are preserved verbatim but are not mapped to source field names.',
            'PassLocker is constructed by AlphaForgeVault; its deployed address and runtime depend on Vault parameters.',
            'AlphaForgeTest assets and venue are TESTNET_ONLY and are not production asset representations.',
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifact-root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()

    contract_root = Path(__file__).resolve().parent.parent
    manifest = build_manifest(contract_root, args.artifact_root.resolve())
    rendered = json.dumps(manifest, indent=2, sort_keys=True) + '\n'

    if args.check:
        if not args.output.is_file() or args.output.read_text() != rendered:
            raise SystemExit('Phase One contract manifest differs from compiler artifacts')
        print('Phase One contract manifest matches compiler artifacts')
        return

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered)
    print(f'Wrote Phase One contract manifest: {args.output}')


if __name__ == '__main__':
    main()
