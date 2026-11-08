"""Explicitly enrolled mail text -> assembler observations. No AI dependencies.

Run separately: python source_connector.py --config /private/source-connector.json.
Config: endpoint, token_file, locator_base, feeds:[{namespace,producer,account,
folder_id,scope}]. Removing a feed disables it and queues withdrawals; never delete
its durable state. One producer per folder. No attachments or trash exported.
"""
import argparse
from datetime import timezone
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import stat
import time
import uuid
from urllib.parse import quote, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

VERSION = 'mail-text-v1/utf8-parts-v1'
MAX_TEXT = 65536
MAX_REQUEST = 512 * 1024


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode('utf-8')


def identity(value, limit):
    if not isinstance(value, str) or not value or len(value.encode()) > limit or any(ord(c)<32 or ord(c)==127 for c in value):
        raise ValueError('Invalid connector identity')
    return value


def partition(text, size=MAX_TEXT):
    data = text.encode('utf-8')
    while data:
        end = min(size, len(data))
        while end < len(data) and data[end] & 0xc0 == 0x80:
            end -= 1
        if not end:
            raise ValueError('Partition limit too small')
        yield data[:end].decode('utf-8')
        data = data[end:]


def records(feed, message, locator_base):
    meta = message['metadata']
    sender = meta.get('sender') or {}
    text = 'Subject: ' + str(meta.get('subject') or '') + '\nFrom: ' + str(sender.get('email') or '') + '\nDate: ' + message['received_at'].astimezone(timezone.utc).isoformat() + '\n\n' + message['body']
    # The native id remains bounded even for long provider identifiers.
    stem = hashlib.sha256(message['message_id'].encode()).hexdigest()
    locator = locator_base.rstrip('/') + '/mail/source?account=' + quote(feed['account'], safe='') + '&messageId=' + quote(message['message_id'], safe='')
    for number, text_part in enumerate(partition(text)):
        native = stem + '/body/' + str(number)
        record = dict(source='mail', scope=feed['scope'], native_id=native,
                      revision=hashlib.sha256((VERSION+'\0'+text_part).encode()).hexdigest(),
                      locator=identity(locator + '#body-part-' + str(number), 1024),
                      range={'unit':'whole_record'}, representation='structured_record', text=text_part)
        yield record


def configure(db, config):
    seen=[]
    for item in config['feeds']:
        for key,limit in [('namespace',1024),('producer',1024),('scope',1024),('account',1024),('folder_id',1024)]:
            identity(item[key],limit)
        existing=db.execute('SELECT * FROM mail_store.source_feed WHERE namespace=%s AND producer=%s', (item['namespace'],item['producer'])).fetchone()
        if existing:
            db.execute("SELECT pg_advisory_xact_lock(hashtextextended('mail-source-feed:'||%s::text,0))",(existing['id'],))
            existing=db.execute('SELECT * FROM mail_store.source_feed WHERE id=%s FOR UPDATE',(existing['id'],)).fetchone()
        if existing and any(existing[k]!=item[k] for k in ('account','folder_id','scope')):
            raise ValueError('Existing producer identity cannot be reassigned')
        if not db.execute('SELECT 1 FROM mail_store.folder WHERE account=%s AND folder_id=%s AND role NOT IN (\'TRASH\',\'SPAM\')', (item['account'],item['folder_id'])).fetchone():
            raise ValueError('Enrollment requires an existing non-trash/non-spam folder')
        feed=db.execute('''INSERT INTO mail_store.source_feed(namespace,producer,account,folder_id,scope)
          VALUES (%s,%s,%s,%s,%s) ON CONFLICT(namespace,producer) DO UPDATE SET enabled=true RETURNING *''',
          tuple(item[k] for k in ('namespace','producer','account','folder_id','scope'))).fetchone()
        seen.append(feed['id'])
        if not existing or not existing['enabled']:
            db.execute('INSERT INTO mail_store.source_dirty SELECT %s,message_id FROM mail_store.message WHERE account=%s ON CONFLICT DO NOTHING',(feed['id'],feed['account']))
    removed=db.execute('SELECT id FROM mail_store.source_feed WHERE enabled AND NOT(id=ANY(%s::bigint[]))',(seen,)).fetchall()
    for feed in removed:
        db.execute("SELECT pg_advisory_xact_lock(hashtextextended('mail-source-feed:'||%s::text,0))",(feed['id'],))
        db.execute('UPDATE mail_store.source_feed SET enabled=false WHERE id=%s',(feed['id'],))
        batch=db.execute('SELECT attempts,envelope FROM mail_store.source_batch WHERE feed_id=%s',(feed['id'],)).fetchone()
        if batch and batch['attempts']:
            if any(c['kind']=='upsert' for c in json.loads(bytes(batch['envelope']))['changes']):
                db.execute("UPDATE mail_store.source_feed SET blocked='Scope revoked with uncertain delivery: reconcile remote cursor before withdrawals' WHERE id=%s",(feed['id'],))
        elif batch:
            db.execute('DELETE FROM mail_store.source_batch WHERE feed_id=%s',(feed['id'],))
        db.execute("DELETE FROM mail_store.source_change WHERE feed_id=%s AND change->>'kind'='upsert' AND sequence>COALESCE((SELECT last_sequence FROM mail_store.source_batch WHERE feed_id=%s),0)",(feed['id'],feed['id']))
        db.execute('INSERT INTO mail_store.source_dirty SELECT feed_id,message_id FROM mail_store.source_head WHERE feed_id=%s ON CONFLICT DO NOTHING',(feed['id'],))



def materialize(db, feed, locator_base):
    dirty=db.execute('SELECT message_id FROM mail_store.source_dirty WHERE feed_id=%s ORDER BY message_id LIMIT 100 FOR UPDATE', (feed['id'],)).fetchall()
    for entry in dirty:
        mid=entry['message_id']
        message=db.execute('SELECT * FROM mail_store.message WHERE account=%s AND message_id=%s',(feed['account'],mid)).fetchone()
        folder=db.execute('SELECT * FROM mail_store.folder WHERE account=%s AND folder_id=%s',(feed['account'],feed['folder_id'])).fetchone()
        provider=db.execute('SELECT provider FROM mail_store.mailbox WHERE account=%s',(feed['account'],)).fetchone()
        member=False
        uncertain=False
        if message and folder and feed['enabled'] and folder['role'] not in ('TRASH','SPAM'):
            if provider['provider']=='gmail':
                member=bool(db.execute('SELECT 1 FROM mail_store.gmail_uid WHERE account=%s AND folder_id=%s AND message_id=%s',(feed['account'],feed['folder_id'],mid)).fetchone())
                uncertain=not member and bool(folder['state'].get('older',0))
            else:
                member=message['folder_id']==feed['folder_id']
            if folder['role']=='INBOX' and not message['in_inbox']:
                member=False
                uncertain=False
            labels=message['metadata'].get('labels',[])
            if any(x in labels for x in ('TRASH','SPAM','\\Trash','\\Spam')):
                member=False
                uncertain=False
        heads=db.execute('SELECT native_id,revision FROM mail_store.source_head WHERE feed_id=%s AND message_id=%s',(feed['id'],mid)).fetchall()
        desired=list(records(feed,message,locator_base)) if member else []
        if uncertain:
            # Membership inserts and the folder backfill-completion trigger retry.
            # Do not let unresolved early IDs starve the rest of the queue.
            db.execute('DELETE FROM mail_store.source_dirty WHERE feed_id=%s AND message_id=%s',(feed['id'],mid))
            continue  # Epoch reset/backfill is not authoritative absence.
        old={h['native_id']:h['revision'] for h in heads}
        new={r['native_id']:r['revision'] for r in desired}
        changes=[{'kind':'upsert','record':r} for r in desired if old.get(r['native_id'])!=r['revision']]
        changes += [dict(kind='withdraw',source='mail',scope=feed['scope'],native_id=n) for n in old if n not in new]
        for change in changes:
            native=change['record']['native_id'] if change['kind']=='upsert' else change['native_id']
            # Supersede unsent content, but never alter a persisted envelope whose
            # acceptance may be uncertain. Its exact retry precedes withdrawal.
            db.execute('''DELETE FROM mail_store.source_change WHERE feed_id=%s
              AND sequence>COALESCE((SELECT last_sequence FROM mail_store.source_batch WHERE feed_id=%s),0)
              AND COALESCE(change->'record'->>'native_id',change->>'native_id')=%s''',(feed['id'],feed['id'],native))
            db.execute('INSERT INTO mail_store.source_change(feed_id,change) VALUES (%s,%s)',(feed['id'],Jsonb(change)))
        db.execute('DELETE FROM mail_store.source_head WHERE feed_id=%s AND message_id=%s',(feed['id'],mid))
        for r in desired:
            db.execute('INSERT INTO mail_store.source_head VALUES (%s,%s,%s,%s)',(feed['id'],mid,r['native_id'],r['revision']))
        db.execute('DELETE FROM mail_store.source_dirty WHERE feed_id=%s AND message_id=%s',(feed['id'],mid))


def stage(db, feed):
    if db.execute('SELECT 1 FROM mail_store.source_batch WHERE feed_id=%s',(feed['id'],)).fetchone():
        return
    pending=db.execute('SELECT sequence,change FROM mail_store.source_change WHERE feed_id=%s ORDER BY sequence LIMIT 32',(feed['id'],)).fetchall()
    mailbox=db.execute('SELECT last_success,last_error FROM mail_store.mailbox WHERE account=%s',(feed['account'],)).fetchone()
    folder=db.execute('SELECT state FROM mail_store.folder WHERE account=%s AND folder_id=%s',(feed['account'],feed['folder_id'])).fetchone()
    coverage=dict(mode='producer_push',status='partial',scope=feed['scope'],attachments='excluded',
                  conversion=VERSION,deleted_content='excluded',selected_folder=feed['folder_id'],
                  enrollment_enabled=feed['enabled'],backfill_boundary=feed['backfill_boundary'].isoformat(),
                  provider_last_success=mailbox['last_success'].isoformat() if mailbox and mailbox['last_success'] else None,
                  provider_error=bool(mailbox and mailbox['last_error']),
                  backfill_pending=bool(folder and folder['state'].get('older',0)),
                  limitation='Coverage is locally synchronized selected-folder text; no provider-wide completeness claim.')
    coverage['local_pending_messages']=db.execute('SELECT count(*) AS n FROM mail_store.source_dirty WHERE feed_id=%s',(feed['id'],)).fetchone()['n']
    if not pending and feed.get('acknowledged_coverage')==hashlib.sha256(encode(coverage)).hexdigest():
        return
    if len(encode(coverage))>4096:
        raise ValueError('Coverage exceeds contract')
    envelope=dict(namespace=feed['namespace'],producer=feed['producer'],previous_cursor=feed['acknowledged_cursor'],
                  cursor=str(uuid.uuid4()),changes=[],coverage=coverage)
    last=0
    for row in pending:
        envelope['changes'].append(row['change'])
        if len(encode(envelope))>MAX_REQUEST:
            envelope['changes'].pop()
            break
        last=row['sequence']
    if pending and not last:
        raise ValueError('Single change exceeds request limit')
    db.execute('INSERT INTO mail_store.source_batch(feed_id,cursor,envelope,last_sequence) VALUES (%s,%s,%s,%s)',
               (feed['id'],envelope['cursor'],encode(envelope),last))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Do not forward the bearer credential to another origin.


def validate_transport(config):
    endpoint=urlsplit(config['endpoint'])
    loopback=False
    try:
        loopback=ipaddress.ip_address(endpoint.hostname or '').is_loopback
    except ValueError:
        loopback=endpoint.hostname=='localhost'
    if endpoint.scheme!='https' and not(endpoint.scheme=='http' and loopback):
        raise ValueError('Observation endpoint requires HTTPS (except loopback)')
    if endpoint.username or endpoint.password or endpoint.query or endpoint.fragment:
        raise ValueError('Observation endpoint cannot contain credentials, query, or fragment')
    locator=urlsplit(config['locator_base'])
    if locator.scheme not in ('https','http') or not locator.netloc or locator.username or locator.password or locator.query or locator.fragment:
        raise ValueError('Invalid source locator base')
    path=Path(config['token_file'])
    if not path.is_absolute() or path.is_symlink():
        raise ValueError('Token must be a private absolute regular file')
    mode=path.stat()
    if not stat.S_ISREG(mode.st_mode) or mode.st_mode & 0o077:
        raise ValueError('Token file permissions must exclude group and others')
    token=path.read_text().strip()
    if not token or any(ord(c)<33 or ord(c)>126 for c in token):
        raise ValueError('Invalid bearer token')
    return token


def publish(db, feed, config):
    batch=db.execute('SELECT * FROM mail_store.source_batch WHERE feed_id=%s AND retry_after<=now()', (feed['id'],)).fetchone()
    db.commit()
    if not batch:
        return
    token=validate_transport(config)
    req=Request(config['endpoint'].rstrip('/')+'/v1/research/observations',data=bytes(batch['envelope']),
                headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method='POST')
    # Persist attempt intent before network I/O, including process death windows.
    db.execute('UPDATE mail_store.source_batch SET attempts=attempts+1 WHERE feed_id=%s',(feed['id'],))
    db.commit()
    try:
        with build_opener(NoRedirect()).open(req,timeout=30) as response:
            if response.status!=200:
                raise ValueError('Unexpected observation response')
            receipt=json.loads(response.read(65537))
            # Never advance on an unrelated or malformed acknowledgement.
            if receipt.get('cursor') != batch['cursor']:
                raise ValueError('Receipt cursor mismatch')
    except HTTPError as error:
        if error.code in (400,401,403,409) or 300<=error.code<400 or 400<=error.code<500 and error.code not in (408,429):
            db.execute('UPDATE mail_store.source_feed SET blocked=%s WHERE id=%s',('HTTP '+str(error.code)+'; reconcile feed before retry',feed['id']))
        else:
            retry(db,feed,batch)
        db.commit()
        return
    except (OSError,ValueError):
        retry(db,feed,batch)
        db.commit()
        return
    db.execute('UPDATE mail_store.source_feed SET acknowledged_cursor=%s,acknowledged_coverage=%s WHERE id=%s',(batch['cursor'],hashlib.sha256(encode(json.loads(bytes(batch['envelope']))['coverage'])).hexdigest(),feed['id']))
    db.execute('DELETE FROM mail_store.source_change WHERE feed_id=%s AND sequence<=%s',(feed['id'],batch['last_sequence']))
    db.execute('DELETE FROM mail_store.source_batch WHERE feed_id=%s',(feed['id'],))
    db.commit()


def retry(db,feed,batch):
    delay=min(300,2**min(batch['attempts']+1,8))
    db.execute("UPDATE mail_store.source_batch SET retry_after=now()+(%s * interval '1 second') WHERE feed_id=%s",(delay,feed['id']))


def tick(db,config):
    # A session advisory lock spans commit-before-network and acknowledgement.
    feeds=db.execute('SELECT id FROM mail_store.source_feed ORDER BY id').fetchall()
    db.commit()
    for item in feeds:
        locked=db.execute("SELECT pg_try_advisory_lock(hashtextextended('mail-source-feed:'||%s::text,0)) AS ok",(item['id'],)).fetchone()['ok']
        db.commit()
        if not locked:
            continue
        try:
            feed=db.execute('SELECT * FROM mail_store.source_feed WHERE id=%s FOR UPDATE',(item['id'],)).fetchone()
            if feed['blocked']:
                db.commit()
                continue
            materialize(db,feed,config['locator_base'])
            stage(db,feed)
            db.commit()  # Exact envelope becomes durable before its first send.
            publish(db,feed,config)
        finally:
            db.rollback()
            db.execute("SELECT pg_advisory_unlock(hashtextextended('mail-source-feed:'||%s::text,0))",(item['id'],))
            db.commit()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--config',required=True)
    parser.add_argument('--once',action='store_true')
    args=parser.parse_args()
    config=json.loads(Path(args.config).read_text())
    validate_transport(config)
    with psycopg.connect(os.environ['DATABASE_URL'],row_factory=dict_row) as db:
        db.execute(Path(__file__).with_name('source-connector.sql').read_text())
        configure(db,config)
        db.commit()
        while True:
            tick(db,config)
            if args.once:
                break
            time.sleep(2)


if __name__=='__main__':
    main()
