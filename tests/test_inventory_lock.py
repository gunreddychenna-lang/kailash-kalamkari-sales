import importlib.util
import multiprocessing
import pathlib
import tempfile
import unittest

SCANNER = pathlib.Path(__file__).resolve().parents[1] / "tools" / "scan_inventory.py"

spec = importlib.util.spec_from_file_location("kk_scanner_lock", SCANNER)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


class InventoryLockTests(unittest.TestCase):
    def test_second_lock_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            state = str(pathlib.Path(folder) / "state.json")

            with scanner.inventory_lock(state):
                with self.assertRaises(RuntimeError):
                    with scanner.inventory_lock(state):
                        pass

            # Lock should be reusable after release.
            with scanner.inventory_lock(state):
                pass


if __name__ == "__main__":
    unittest.main()
