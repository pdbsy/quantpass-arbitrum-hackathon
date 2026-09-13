"""Derive a reviewed pragma-only OpenZeppelin subset without altering upstream.

Both Forge and Slither consume the same derived tree. Its manifest fixes every
input/output hash; an existing mismatched tree is rejected, never repaired.
"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'node_modules/@alphaforge/openzeppelin-pinned'
UPSTREAM = ROOT / 'node_modules/@openzeppelin/contracts'


def derive_source(data, entry):
    if hashlib.sha256(data).hexdigest() != entry['originalSha256']:
        raise ValueError('Original checksum mismatch: ' + entry['path'])
    if entry['pragma'] not in ('pragma solidity ^0.8.20;', 'pragma solidity >=0.4.16;'):
        raise ValueError('Unsupported pragma constraint')
    old = entry['pragma'].encode()
    if data.count(old) != 1 or b'\n' + old + b'\n' not in data:
        raise ValueError('Expected exactly one complete pragma line')
    result = data.replace(old, b'pragma solidity 0.8.31;', 1)
    if hashlib.sha256(result).hexdigest() != entry['derivedSha256']:
        raise ValueError('Derived checksum mismatch: ' + entry['path'])
    return result


def reject_symlinks(path):
    if any(parent.is_symlink() for parent in (path, *path.parents)):
        raise ValueError('Symlink in dependency path')


def materialize(upstream, target, entries, license_data):
    paths = [entry['path'] for entry in entries]
    for name in paths:
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or str(path) != name or '\\' in name or path.suffix != '.sol':
            raise ValueError('Unsafe manifest path')
    if len(set(paths)) != len(paths) or not paths:
        raise ValueError('Duplicate or empty dependency manifest')
    reject_symlinks(upstream)
    reject_symlinks(target)
    expected = {}
    for entry in entries:
        source = upstream / entry['path']
        reject_symlinks(source)
        expected[entry['path']] = derive_source(source.read_bytes(), entry)
    expected['LICENSE'] = license_data
    if target.exists():
        actual = {}
        for path in target.rglob('*'):
            reject_symlinks(path)
            if path.is_file():
                actual[path.relative_to(target).as_posix()] = path.read_bytes()
            elif not path.is_dir():
                raise ValueError('Nonregular derived file')
        if actual != expected:
            raise ValueError('Derived tree drift; inspect instead of overwriting')
    else:
        target.mkdir(parents=True)
        for name, data in expected.items():
            path = target / name
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('xb') as output:
                output.write(data)
    return expected


def compile_outputs(dependency, entries):
    sources = {'src/VaultIntentPreview.sol': {'content': (ROOT / 'src/VaultIntentPreview.sol').read_text()}}
    for entry in entries:
        sources['@openzeppelin/contracts/' + entry['path']] = {'content': (dependency / entry['path']).read_text()}
    request = {'language': 'Solidity', 'sources': sources, 'settings': {
        'evmVersion': 'paris', 'optimizer': {'enabled': False}, 'viaIR': False,
        'metadata': {'bytecodeHash': 'none', 'appendCBOR': False},
        'outputSelection': {'*': {'*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object']}}
    }}
    result = subprocess.run([str(ROOT / '../.checks/af-chain01/toolchain/bin/solc'), '--standard-json'],
                            input=json.dumps(request), text=True, capture_output=True, check=True)
    output = json.loads(result.stdout)
    if any(error['severity'] == 'error' for error in output.get('errors', [])):
        raise ValueError('Dependency equivalence compilation failed')
    contracts = output.get('contracts', {})
    if not contracts.get('src/VaultIntentPreview.sol', {}).get('VaultIntentPreview', {}).get('evm', {}).get('bytecode', {}).get('object'):
        raise ValueError('No preview creation bytecode to compare')
    return contracts


def verify_equivalence(original, derived):
    if not original or not derived:
        raise ValueError('Empty compilation cannot establish equivalence')
    if original != derived:
        raise ValueError('Original/derived ABI or bytecode differs')


def verify_forge_output():
    entries = json.loads((ROOT / 'openzeppelin-pragma-pins.json').read_text())['files']
    expected = compile_outputs(TARGET, entries)['src/VaultIntentPreview.sol']['VaultIntentPreview']
    actual = json.loads((ROOT / '../.checks/af-chain01/out/VaultIntentPreview.sol/VaultIntentPreview.json').read_text())
    # Forge reorders ABI entries; compare complete entries in canonical order.
    expected['abi'] = sorted(expected['abi'], key=lambda entry: json.dumps(entry, sort_keys=True))
    actual_abi = sorted(actual['abi'], key=lambda entry: json.dumps(entry, sort_keys=True))
    verify_equivalence(expected, {'abi': actual_abi, 'evm': {
        'bytecode': {'object': actual['bytecode']['object'].removeprefix('0x')},
        'deployedBytecode': {'object': actual['deployedBytecode']['object'].removeprefix('0x')}
    }})
    print('Forge preview ABI and creation/runtime bytecode match verified dependency comparison')


def prepare():
    manifest = json.loads((ROOT / 'openzeppelin-pragma-pins.json').read_text())
    lock = json.loads((ROOT / 'toolchain.lock.json').read_text())
    if manifest['upstreamArchiveSha256'] != lock['openzeppelin']['sha256'] or manifest['compiler'] != lock['solc']['version']:
        raise ValueError('Pinned dependency/toolchain manifest mismatch')
    entries = manifest['files']
    license_data = (ROOT / 'licenses/OpenZeppelin-LICENSE').read_bytes()
    if hashlib.sha256(license_data).hexdigest() != manifest['licenseSha256']:
        raise ValueError('License checksum mismatch')
    materialize(UPSTREAM, TARGET, entries, license_data)
    original = compile_outputs(UPSTREAM, entries)
    derived = compile_outputs(TARGET, entries)
    verify_equivalence(original, derived)
    digest = hashlib.sha256(json.dumps(derived, sort_keys=True).encode()).hexdigest()
    evidence = {'status': 'PASS', 'upstreamUnmodified': True, 'derivedFiles': len(entries),
                'comparison': 'All compiled ABI, creation bytecode and runtime bytecode identical',
                'compiler': lock['solc']['longVersion'], 'outputsSha256': digest,
                'manifestSha256': hashlib.sha256((ROOT / 'openzeppelin-pragma-pins.json').read_bytes()).hexdigest()}
    directory = ROOT / '../.checks/af-chain01/evidence'
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'dependency-equivalence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print('Pinned dependency: 10 pragma-only changes; original/derived ABI and bytecode identical')
