import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

SCANNER_PATH = pathlib.Path(__file__).resolve().parents[1] / "tools" / "scan_inventory.py"

spec = importlib.util.spec_from_file_location("kk_inventory_scanner", SCANNER_PATH)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


class CheckpointRecoveryTests(unittest.TestCase):

    def test_interrupted_second_write_recovers(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            state_path = root / "state.json"
            snapshot_path = root / "snapshot.json"
            journal = root / "state.json.pending.json"

            old_state = {"scan_number": 1, "records": [{"stable_id": "old"}]}
            old_snapshot = {
                "source": "local_drive_csv_audit",
                "snapshot": True,
                "total_images": 1,
                "items": [{"filename": "old.jpg"}]
            }

            new_state = {"scan_number": 2, "records": [{"stable_id": "new"}]}
            new_snapshot = {
                "source": "local_drive_csv_audit",
                "snapshot": True,
                "total_images": 1,
                "items": [{"filename": "new.jpg"}]
            }

            scanner.atomic_write(str(state_path), old_state)
            scanner.atomic_write(str(snapshot_path), old_snapshot)

            original_write = scanner.atomic_write

            def simulated_failure(path, data):
                if pathlib.Path(path) == snapshot_path:
                    raise OSError("Simulated snapshot write interruption")
                return original_write(path, data)

            with patch.object(scanner, "atomic_write", side_effect=simulated_failure):
                with self.assertRaises(OSError):
                    scanner.write_checkpoint(
                        str(state_path),
                        str(snapshot_path),
                        new_state,
                        new_snapshot
                    )

            self.assertTrue(journal.exists())
            self.assertEqual(json.loads(snapshot_path.read_text()), old_snapshot)

            scanner.recover_checkpoint(str(state_path), str(snapshot_path))

            self.assertFalse(journal.exists())
            self.assertEqual(json.loads(state_path.read_text()), new_state)
            self.assertEqual(json.loads(snapshot_path.read_text()), new_snapshot)


if __name__ == "__main__":
    unittest.main()
