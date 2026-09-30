"""Behavioral qualification of the restricted AlphaForge wheel derivation."""
import base64
import csv
import hashlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import patch_semgrep
import zipfile

from patch_semgrep import build_wheel, METADATA, RECORD


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fixture(path, change=None):
    files = {
        METADATA: b"Metadata-Version: 2.4\nName: semgrep\nVersion: 1.177.0\nRequires-Dist: pyjwt[crypto]~=2.13.0\nRequires-Dist: other==1.0\n",
        "semgrep-1.177.0.dist-info/WHEEL": b"Wheel-Version: 1.0\n",
        "semgrep-1.177.0.data/purelib/semgrep/bin/semgrep-core": b"native fixture\x00\xff",
        "semgrep-1.177.0.dist-info/licenses/LICENSE": b"preserved license",
    }
    if change:
        change(files)
    buf = io.StringIO(newline="")
    writer = csv.writer(buf, lineterminator="\n")
    for name, data in files.items():
        value = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
        writer.writerow([name, "sha256=" + value, len(data)])
    writer.writerow([RECORD, "", ""])
    files[RECORD] = buf.getvalue().encode()
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            info = zipfile.ZipInfo(name, (2024, 4, 3, 2, 1, 0))
            info.external_attr = (0o100755 if "semgrep-core" in name else 0o100644) << 16
            z.writestr(info, data)
    return digest(path.read_bytes())


class DerivationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="alphaforge-wheel-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source.whl"
        self.output = self.root / "derived.whl"

    def test_reproducible_and_preserves_all_non_metadata_bytes_and_permissions(self):
        sha = fixture(self.source)
        first = build_wheel(self.source, self.output, sha)
        second = self.root / "second.whl"
        self.assertEqual(first, build_wheel(self.source, second, sha))
        self.assertEqual(self.output.read_bytes(), second.read_bytes())
        with zipfile.ZipFile(self.source) as source, zipfile.ZipFile(self.output) as derived:
            self.assertEqual(sorted(source.namelist()), sorted(derived.namelist()))
            for name in source.namelist():
                if name not in (METADATA, RECORD):
                    self.assertEqual(source.read(name), derived.read(name))
                self.assertEqual(source.getinfo(name).external_attr, derived.getinfo(name).external_attr)
            self.assertEqual(derived.read(METADATA), source.read(METADATA).replace(b"~=2.13.0", b"~=2.14.0"))
            for name, value, size in csv.reader(io.StringIO(derived.read(RECORD).decode())):
                if name == RECORD:
                    self.assertEqual((value, size), ("", ""))
                else:
                    data = derived.read(name)
                    actual = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
                    self.assertEqual(value, "sha256=" + actual)
                    self.assertEqual(int(size), len(data))

    def test_source_tampering_fails_before_output(self):
        sha = fixture(self.source)
        self.source.write_bytes(self.source.read_bytes() + b"modified")
        with self.assertRaisesRegex(ValueError, "source digest"):
            build_wheel(self.source, self.output, sha)
        self.assertFalse(self.output.exists())

    def test_rejects_missing_or_ambiguous_authorized_dependency(self):
        for replacement in (b"Requires-Dist: pyjwt[crypto]~=2.12.0", b"Requires-Dist: pyjwt[crypto]~=2.13.0\nRequires-Dist: pyjwt>=2"):
            sha = fixture(self.source, lambda files: files.update({METADATA: files[METADATA].replace(b"Requires-Dist: pyjwt[crypto]~=2.13.0", replacement)}))
            with self.assertRaisesRegex(ValueError, "dependency"):
                build_wheel(self.source, self.output, sha)
            self.assertFalse(self.output.exists())

    def test_rejects_traversal_duplicate_symlink_and_incorrect_record(self):
        for kind in ("traversal", "duplicate", "symlink", "record"):
            sha = fixture(self.source, (lambda files: files.update({"../escaped": b"bad"})) if kind == "traversal" else None)
            if kind != "traversal":
                with zipfile.ZipFile(self.source, "a") as z:
                    name = "added" if kind == "record" else METADATA if kind == "duplicate" else "link"
                    info = zipfile.ZipInfo(name)
                    if kind == "symlink":
                        info.external_attr = 0o120777 << 16
                    z.writestr(info, b"bad")
                sha = digest(self.source.read_bytes())
            with self.assertRaises(ValueError):
                build_wheel(self.source, self.output, sha)
            self.assertFalse(self.output.exists())

    def test_refuses_overwrite_and_changed_record_hash(self):
        sha = fixture(self.source)
        self.output.write_bytes(b"existing evidence")
        with self.assertRaises(FileExistsError):
            build_wheel(self.source, self.output, sha)
        self.assertEqual(self.output.read_bytes(), b"existing evidence")
        self.output.unlink()
        with zipfile.ZipFile(self.source) as z:
            files = {i.filename: z.read(i) for i in z.infolist()}
        files[RECORD] = files[RECORD].replace(b"sha256=", b"sha256=x", 1)
        with zipfile.ZipFile(self.source, "w") as z:
            for name, data in files.items():
                z.writestr(name, data)
        with self.assertRaisesRegex(ValueError, "RECORD"):
            build_wheel(self.source, self.output, digest(self.source.read_bytes()))
        self.assertFalse(self.output.exists())

    def test_bounds_and_partial_write_failure_preserve_existing_evidence(self):
        sha = fixture(self.source)
        with patch.object(patch_semgrep, "MAX_BYTES", self.source.stat().st_size - 1):
            with self.assertRaisesRegex(ValueError, "source file"):
                build_wheel(self.source, self.output, sha)
        with patch.object(zipfile.ZipFile, "writestr", side_effect=OSError("synthetic disk failure")):
            with self.assertRaisesRegex(OSError, "disk failure"):
                build_wheel(self.source, self.output, sha)
        self.assertFalse(self.output.exists())
        # A small compressed input whose expanded members exceed the configured bound.
        fixture(self.source, lambda files: files.update({"large": b"a" * 20000}))
        with zipfile.ZipFile(self.source) as z:
            files = {i.filename: z.read(i) for i in z.infolist()}
        with zipfile.ZipFile(self.source, "w", compression=zipfile.ZIP_DEFLATED) as z:
            for name, data in files.items():
                z.writestr(name, data)
        self.assertLess(self.source.stat().st_size, 4096)
        with patch.object(patch_semgrep, "MAX_BYTES", 4096):
            with self.assertRaisesRegex(ValueError, "uncompressed size"):
                build_wheel(self.source, self.output, digest(self.source.read_bytes()))
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
