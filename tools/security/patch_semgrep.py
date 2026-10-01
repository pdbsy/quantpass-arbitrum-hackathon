"""AlphaForge dependency patch 2: Semgrep 1.177.0 metadata only.

Retains the upstream distribution version and all source/native/license bytes.
The distinct 1alphaforge2 wheel build tag and repository lock identify this
modified distribution. ZIP_STORED avoids host-dependent compression output.
"""
import base64
import csv
import hashlib
import io
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile

METADATA = "semgrep-1.177.0.dist-info/METADATA"
RECORD = "semgrep-1.177.0.dist-info/RECORD"
OLD = b"Requires-Dist: pyjwt[crypto]~=2.13.0\n"
NEW = b"Requires-Dist: pyjwt[crypto]~=2.15.0\n"
MAX_BYTES = 512 * 1024 * 1024


def record_hash(data):
    return "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()


def build_wheel(source, destination, source_sha256):
    source, destination = Path(source), Path(destination)
    if source.is_symlink() or not source.is_file() or source.stat().st_size > MAX_BYTES:
        raise ValueError("Invalid source file")
    if not re.fullmatch(r"[a-f0-9]{64}", source_sha256):
        raise ValueError("Invalid source digest")
    with source.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != source_sha256:
            raise ValueError("Upstream source digest mismatch")
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(entries) > 10000 or len(set(names)) != len(names):
            raise ValueError("Invalid or duplicate ZIP entries")
        if sum(entry.file_size for entry in entries) > MAX_BYTES:
            raise ValueError("ZIP exceeds uncompressed size bound")
        for entry in entries:
            path = PurePosixPath(entry.filename)
            if (path.is_absolute() or ".." in path.parts or "\\" in entry.filename
                    or str(path) != entry.filename or entry.is_dir()
                    or entry.flag_bits & 1 or stat.S_ISLNK(entry.external_attr >> 16)):
                raise ValueError("Unsafe ZIP member")
        if METADATA not in names or RECORD not in names:
            raise ValueError("Missing official wheel metadata")
        metadata = archive.read(METADATA)
        dependencies = [line for line in metadata.splitlines() if re.match(br"Requires-Dist: pyjwt(?:\[|[ >=~!])", line, re.IGNORECASE)]
        if metadata.count(OLD) != 1 or dependencies != [OLD.rstrip(b"\n")]:
            raise ValueError("Ambiguous or changed authorized dependency")
        if b"Name: semgrep\n" not in metadata or b"Version: 1.177.0\n" not in metadata:
            raise ValueError("Unexpected upstream identity")
        rows = list(csv.reader(io.StringIO(archive.read(RECORD).decode("utf-8"))))
        if any(len(row) != 3 for row in rows) or len({row[0] for row in rows}) != len(rows):
            raise ValueError("Malformed RECORD")
        records = {row[0]: row[1:] for row in rows}
        if set(records) != set(names) or records[RECORD] != ["", ""]:
            raise ValueError("Incomplete RECORD")
        for entry in entries:
            if entry.filename == RECORD:
                continue
            data = archive.read(entry)
            if records[entry.filename] != [record_hash(data), str(len(data))]:
                raise ValueError("Source RECORD hash mismatch")
        # Exclusive output; the caller performs final hash validation and atomic publication.
        created = False
        try:
            with destination.open("xb") as output:
                created = True
                with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as derived:
                    record = io.StringIO(newline="")
                    writer = csv.writer(record, lineterminator="\n")
                    for entry in sorted(entries, key=lambda value: value.filename):
                        if entry.filename == RECORD:
                            continue
                        data = metadata.replace(OLD, NEW) if entry.filename == METADATA else archive.read(entry)
                        info = zipfile.ZipInfo(entry.filename, (1980, 1, 1, 0, 0, 0))
                        info.create_system = 3
                        info.external_attr = entry.external_attr
                        derived.writestr(info, data)
                        writer.writerow([entry.filename, record_hash(data), len(data)])
                    writer.writerow([RECORD, "", ""])
                    info = zipfile.ZipInfo(RECORD, (1980, 1, 1, 0, 0, 0))
                    info.create_system = 3
                    info.external_attr = archive.getinfo(RECORD).external_attr
                    derived.writestr(info, record.getvalue().encode("utf-8"))
                output.flush()
                os.fsync(output.fileno())
            with destination.open("rb") as stream:
                return hashlib.file_digest(stream, "sha256").hexdigest()
        except BaseException:
            if created:
                destination.unlink(missing_ok=True)
            raise


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("Expected source wheel, exclusive output and pinned source digest")
    print(build_wheel(*sys.argv[1:]))
