#!/usr/bin/env python3.12
"""Install the locked local tools only; no blockchain commands or credentials."""
import base64
import hashlib
import json
import platform
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import os
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def select_lock(lock, system=None, machine=None, python_version=None):
    system = system or platform.system()
    machine = machine or platform.machine()
    python_version = python_version or sys.version_info[:3]
    if tuple(python_version) != (3, 12, 9):
        raise ValueError("Locked tools require CPython 3.12.9")
    if (system, machine) == ("Darwin", "arm64"):
        return dict(lock)
    if (system, machine) == ("Linux", "x86_64"):
        return {**lock, **lock["platforms"]["linux-x64"]}
    raise ValueError("Locked tools support Darwin arm64 and Linux x86_64 only")


def verify(path, artifact):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != artifact["sha256"]:
        raise ValueError(f"SHA-256 mismatch: {path.name}")
    if "integrity" in artifact:
        actual = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()
        if actual != artifact["integrity"]:
            raise ValueError(f"SHA-512 mismatch: {path.name}")


def main():
    if len(sys.argv) != 1:
        raise SystemExit("bootstrap.py accepts no arguments")
    lock = select_lock(json.loads((ROOT / "toolchain.lock.json").read_text()))
    for key, value in os.environ.items():
        if value and (key.upper() in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR", "PYTHONPATH", "PYTHONHOME") or key.startswith("PIP_")):
            raise SystemExit("Injected download/Python/pip configuration is not admitted")
    requirements = ROOT / lock["slither"]["requirements"]
    if hashlib.sha256(requirements.read_bytes()).hexdigest() != lock["slither"]["requirementsSha256"]:
        raise SystemExit("Slither requirements checksum mismatch")
    downloads = ROOT / "../.checks/af-chain01/toolchain/downloads"
    binaries = ROOT / "../.checks/af-chain01/toolchain/bin"
    downloads.mkdir(parents=True, exist_ok=True)
    binaries.mkdir(parents=True, exist_ok=True)
    for name in ("foundry", "solc", "openzeppelin"):
        artifact = lock[name]
        destination = downloads / artifact["filename"]
        if not destination.exists():
            partial = destination.with_suffix(destination.suffix + ".partial")
            with urllib.request.urlopen(artifact["url"], timeout=60) as source, partial.open("wb") as target:
                if not source.url.startswith("https://"):
                    raise SystemExit("Non-HTTPS artifact redirect rejected")
                shutil.copyfileobj(source, target)
            verify(partial, artifact)
            partial.replace(destination)
        verify(destination, artifact)
        if name == "foundry":
            with tarfile.open(destination) as archive:
                member = archive.getmember("package/bin/forge")
                if not member.isfile():
                    raise SystemExit("Forge archive member is not a regular file")
                with archive.extractfile(member) as source, (binaries / "forge").open("wb") as target:
                    shutil.copyfileobj(source, target)
            (binaries / "forge").chmod(0o755)
        elif name == "solc":
            shutil.copyfile(destination, binaries / "solc")
            (binaries / "solc").chmod(0o755)
        else:
            dependency = ROOT / "node_modules/@openzeppelin/contracts"
            dependency.mkdir(parents=True, exist_ok=True)
            with tarfile.open(destination) as archive:
                for member in archive.getmembers():
                    if not member.name.startswith("package/"):
                        raise SystemExit("Unexpected OpenZeppelin archive prefix")
                    member.name = member.name.removeprefix("package/")
                    archive.extract(member, dependency, filter="data")
        print(f"Verified and installed {name} {artifact['version']}", flush=True)
    venv = ROOT / "../.checks/af-chain01/toolchain/slither-venv"
    subprocess.run([sys.executable, "-m", "venv", str(venv)], check=True)
    wheel_options = ["--index-url", "https://pypi.org/simple"]
    if "wheelManifest" in lock["slither"]:
        manifest = ROOT / lock["slither"]["wheelManifest"]
        if hashlib.sha256(manifest.read_bytes()).hexdigest() != lock["slither"]["wheelManifestSha256"]:
            raise SystemExit("Wheel manifest checksum mismatch")
        wheels = downloads / "wheels"
        wheels.mkdir(exist_ok=True)
        for record in json.loads(manifest.read_text()):
            name = record["filename"]
            if Path(name).name != name or not name.endswith(".whl") or not record["url"].startswith("https://files.pythonhosted.org/"):
                raise SystemExit("Wheel artifact identity rejected")
            wheel = wheels / name
            if not wheel.exists():
                partial = wheel.with_suffix(".whl.partial")
                with urllib.request.urlopen(record["url"], timeout=60) as source, partial.open("wb") as target:
                    if not source.url.startswith("https://"):
                        raise SystemExit("Wheel redirect rejected")
                    shutil.copyfileobj(source, target)
                verify(partial, record)
                partial.replace(wheel)
            verify(wheel, record)
        wheel_options = ["--no-index", "--find-links", str(wheels)]
    subprocess.run([
        str(venv / "bin/python"), "-m", "pip", "--isolated", "install", *wheel_options,
        "--require-hashes", "--only-binary=:all:", "--cache-dir", str(ROOT / "../.checks/af-chain01/toolchain/pip-cache"),
        "-r", str(requirements),
    ], check=True)
    print("Native tool installation complete. Run bash script/check-local.sh; Testnet Writes = CLOSED.")


if __name__ == "__main__":
    main()
