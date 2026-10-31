import pathlib
import subprocess
import sys
import tempfile
import json
import unittest

SCANNER = pathlib.Path(__file__).resolve().parents[1] / "tools" / "scan_inventory.py"

class ScannerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        self.kk = self.root / "KK" / "Silk"
        self.kh = self.root / "KHPS" / "Cotton"
        self.kk.mkdir(parents=True)
        self.kh.mkdir(parents=True)
        self.state = self.root / "state.json"
        self.snapshot = self.root / "snapshot.json"

    def add(self, folder, count):
        for i in range(count):
            (folder / f"item{i}.jpg").write_bytes(bytes([i, 1, 2, 3]))

    def scan(self):
        return subprocess.run([
            sys.executable, str(SCANNER),
            "--root-kk", str(self.kk.parent),
            "--root-khps", str(self.kh.parent),
            "--state", str(self.state),
            "--snapshot", str(self.snapshot),
            "--write"
        ], capture_output=True, text=True, timeout=60)

    def unchanged(self, before):
        self.assertEqual(self.state.read_bytes(), before[0])
        self.assertEqual(self.snapshot.read_bytes(), before[1])

    def saved(self):
        return self.state.read_bytes(), self.snapshot.read_bytes()

    def test_empty_store_rejected(self):
        self.add(self.kk, 1)
        self.add(self.kh, 1)
        self.assertEqual(self.scan().returncode, 0)
        before = self.saved()
        (self.kk / "item0.jpg").unlink()
        self.assertNotEqual(self.scan().returncode, 0)
        self.unchanged(before)

    def test_partial_outage_rejected(self):
        self.add(self.kk, 20)
        self.add(self.kh, 20)
        self.assertEqual(self.scan().returncode, 0)
        before = self.saved()
        for i in range(5, 20):
            (self.kk / f"item{i}.jpg").unlink()
        self.assertNotEqual(self.scan().returncode, 0)
        self.unchanged(before)

    def test_two_scan_deletion(self):
        self.add(self.kk, 2)
        self.add(self.kh, 1)
        self.assertEqual(self.scan().returncode, 0)
        (self.kk / "item0.jpg").unlink()
        self.assertEqual(self.scan().returncode, 0)
        self.assertEqual(json.loads(self.snapshot.read_text())["total_images"], 3)
        self.assertEqual(self.scan().returncode, 0)
        self.assertEqual(json.loads(self.snapshot.read_text())["total_images"], 2)

if __name__ == "__main__":
    unittest.main()
