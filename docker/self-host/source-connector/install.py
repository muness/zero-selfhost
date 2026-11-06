"""Install transactional capture into an existing mail_store importer database."""
import os
from pathlib import Path
import psycopg

with psycopg.connect(os.environ['DATABASE_URL']) as db:
    # A missing importer schema fails the transaction; never create an empty fake mailbox.
    db.execute((Path(__file__).parent / 'source-connector.sql').read_text())
