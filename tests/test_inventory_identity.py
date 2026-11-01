import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCANNER = pathlib.Path(__file__).resolve().parents[1] / "tools" / "scan_inventory.py"


class InventoryIdentityTests(unittest.TestCase):

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

        self.root = pathlib.Path(self.temp.name)
        self.main = self.root / "Main" / "Silk"
        self.khps = self.root / "KHPS" / "Cotton"

        self.main.mkdir(parents=True)
        self.khps.mkdir(parents=True)

        self.state = self.root / "state.json"
        self.snapshot = self.root / "snapshot.json"

        (self.main / "Keep.jpg").write_bytes(b"keep")
        (self.khps / "Keep.jpg").write_bytes(b"other")

    def scan(self):
        result = subprocess.run(
            [
                sys.executable,
                str(SCANNER),
                "--root-kk", str(self.main.parent),
                "--root-khps", str(self.khps.parent),
                "--state", str(self.state),
                "--snapshot", str(self.snapshot),
                "--write",
            ],
            capture_output=True,
            text=True,
            timeout=60
        )

        self.assertEqual(
            result.returncode,
            0,
            result.stdout + result.stderr
        )

        return json.loads(self.state.read_text(encoding="utf-8"))["records"]

    def get_id(self, records, filename):
        matches = [
            item["stable_id"]
            for item in records
            if item["store"] == "Main Catalogue"
            and item["filename"] == filename
        ]

        self.assertEqual(len(matches), 1)
        return matches[0]

    def test_reuploaded_photo_receives_new_identity(self):
        photo = self.main / "Floral & Green.jpg"
        photo.write_bytes(b"same-photo-content")

        records = self.scan()
        original_id = self.get_id(records, photo.name)

        photo.unlink()

        self.scan()
        records = self.scan()

        self.assertFalse(
            any(r["filename"] == photo.name for r in records)
        )

        photo.write_bytes(b"same-photo-content")

        records = self.scan()
        new_id = self.get_id(records, photo.name)

        self.assertNotEqual(original_id, new_id)

    def test_identical_photos_are_distinct_items(self):
        (self.main / "Lotus & Red.jpg").write_bytes(b"identical")
        (self.main / "Lotus & Red (1).jpg").write_bytes(b"identical")

        records = self.scan()

        first_id = self.get_id(records, "Lotus & Red.jpg")
        second_id = self.get_id(records, "Lotus & Red (1).jpg")

        self.assertNotEqual(first_id, second_id)

    def test_renamed_photo_preserves_identity(self):
        old = self.main / "Peacock & Blue.jpg"
        new = self.main / "Peacock & Navy.jpg"

        old.write_bytes(b"unique-photo")

        first = self.scan()
        old_id = self.get_id(first, old.name)

        old.rename(new)

        second = self.scan()
        new_id = self.get_id(second, new.name)

        self.assertEqual(old_id, new_id)

    def test_unstructured_filename_not_invented(self):
        (self.main / "IMG_001.jpg").write_bytes(b"photo")

        self.scan()

        snapshot = json.loads(
            self.snapshot.read_text(encoding="utf-8")
        )

        item = next(
            x for x in snapshot["items"]
            if x["filename"] == "IMG_001.jpg"
        )

        self.assertEqual(item["design"], "Not Defined")
        self.assertEqual(item["colour"], "Not Defined")


if __name__ == "__main__":
    unittest.main()
