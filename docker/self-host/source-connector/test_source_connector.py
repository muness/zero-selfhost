"""Offline protocol tests; integration tests use a disposable Postgres database."""
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest

from source_connector import encode, identity, partition, records, validate_transport


class SourceTextTests(unittest.TestCase):
    def test_multibyte_partition_preserves_every_byte_and_limit(self):
        text=('é🙂汉字'*20000)+'last'
        parts=list(partition(text))
        self.assertGreater(len(parts),1)
        self.assertEqual(''.join(parts),text)
        self.assertTrue(all(0<len(p.encode())<=65536 for p in parts))
        self.assertEqual(parts,list(partition(text)))

    def test_stable_record_identity_correction_and_shrink(self):
        feed={'scope':'account/inbox','account':'a@example.test'}
        message={'message_id':'x'*1100,'received_at':datetime(2025,1,1,tzinfo=timezone.utc),
                 'metadata':{'subject':'Subject','sender':{'email':'sender@example.test'},'attachmentNames':['SECRET']},
                 'body':'body'*40000}
        # Long provider IDs cannot form valid source locators: fail, never truncate.
        with self.assertRaises(ValueError):
            list(records(feed,message,'https://mail.example.test'))
        message['message_id']='provider-id'
        original=list(records(feed,message,'https://mail.example.test'))
        self.assertGreater(len(original),1)
        self.assertNotIn('SECRET',encode(original).decode())
        message['body']='corrected'
        corrected=list(records(feed,message,'https://mail.example.test'))
        self.assertEqual(original[0]['native_id'],corrected[0]['native_id'])
        self.assertNotEqual(original[0]['revision'],corrected[0]['revision'])
        self.assertEqual(set(corrected[0]),{'source','scope','native_id','revision','locator','range','representation','text'})
        self.assertEqual(corrected[0]['representation'],'structured_record')

    def test_identities_are_byte_bounded(self):
        for value in ('','bad\nname','🙂'*400):
            with self.assertRaises(ValueError):
                identity(value,1024)

    def test_transport_rejects_insecure_remote_and_public_token(self):
        with tempfile.TemporaryDirectory() as tmp:
            token=Path(tmp)/'token'
            token.write_text('private-token')
            token.chmod(0o600)
            config={'endpoint':'http://127.0.0.1:9000','token_file':str(token),'locator_base':'https://mail.example.test'}
            self.assertEqual(validate_transport(config),'private-token')
            for endpoint in ('http://remote.example.test','https://user:pass@example.test','https://example.test?token=secret'):
                with self.assertRaises(ValueError):
                    validate_transport({**config,'endpoint':endpoint})
            token.chmod(0o644)
            with self.assertRaises(ValueError):
                validate_transport(config)


if __name__=='__main__':
    unittest.main()
