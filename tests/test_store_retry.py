"""Cross-platform resume publication contract, using synthetic bytes only."""
from pathlib import Path
import tempfile
import unittest

import migration as m


class StoreRetry(unittest.TestCase):
    def test_record_published_before_checkpoint_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temp:
            store = m.Store(Path(temp).resolve() / 'library', create=True)
            try:
                with store.lock():
                    store.write('record.json', b'{"synthetic":true}')
                    store.write('record.json', b'{"synthetic":true}')
                    with self.assertRaises(m.StorageConflict):
                        store.write('record.json', b'{"synthetic":false}')
                    self.assertEqual(store.read('record.json'), b'{"synthetic":true}')
            finally:
                store.close()


if __name__ == '__main__':
    unittest.main()
