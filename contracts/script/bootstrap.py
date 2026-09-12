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

ROOT = Path(__file__).resolve().parents[1]


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
    if platform.system() != "Darwin" or platform.machine() != "arm64" or sys.version_info[:2] != (3, 12):
        raise SystemExit("Locked bootstrap supports macOS arm64 with CPython 3.12 only")
    lock = json.loads((ROOT / "toolchain.lock.json").read_text())
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
            subprocess.run([
                "curl", "--fail", "--location", "--retry", "0", "--connect-timeout", "20",
                "--max-time", "600", "--continue-at", "-", "--output", str(partial), artifact["url"],
            ], check=True)
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
    subprocess.run([
        str(venv / "bin/python"), "-m", "pip", "install", "--index-url", "https://pypi.org/simple",
        "--require-hashes", "--only-binary=:all:", "--cache-dir", str(ROOT / "../.checks/af-chain01/toolchain/pip-cache"),
        "-r", str(requirements),
    ], check=True)
    print("Local tool installation complete. Run bash script/check-local.sh; Testnet Writes = CLOSED.")


if __name__ == "__main__":
    main()
