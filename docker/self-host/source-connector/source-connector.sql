-- No enrollment is implicit. Retain feed/outbox rows on source deletion.
CREATE TABLE IF NOT EXISTS mail_store.source_feed (
 id bigserial PRIMARY KEY, namespace text NOT NULL, producer text NOT NULL,
 account text NOT NULL, folder_id text NOT NULL, scope text NOT NULL,
 enabled boolean NOT NULL DEFAULT true, backfill_boundary timestamptz NOT NULL DEFAULT now(),
 acknowledged_cursor text, acknowledged_coverage text, blocked text, UNIQUE(namespace,producer), UNIQUE(namespace,scope)
);
CREATE TABLE IF NOT EXISTS mail_store.source_dirty (
 feed_id bigint REFERENCES mail_store.source_feed, message_id text NOT NULL,
 PRIMARY KEY(feed_id,message_id)
);
CREATE TABLE IF NOT EXISTS mail_store.source_head (
 feed_id bigint REFERENCES mail_store.source_feed, message_id text NOT NULL,
 native_id text NOT NULL, revision text NOT NULL, PRIMARY KEY(feed_id,native_id)
);
CREATE TABLE IF NOT EXISTS mail_store.source_change (
 sequence bigserial PRIMARY KEY, feed_id bigint REFERENCES mail_store.source_feed,
 change jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_store.source_batch (
 feed_id bigint PRIMARY KEY REFERENCES mail_store.source_feed,
 cursor text NOT NULL, envelope bytea NOT NULL, last_sequence bigint NOT NULL,
 attempts integer NOT NULL DEFAULT 0, retry_after timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION mail_store.source_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a text; m text;
BEGIN
 a:=COALESCE(NEW.account,OLD.account); m:=COALESCE(NEW.message_id,OLD.message_id);
 INSERT INTO mail_store.source_dirty SELECT id,m FROM mail_store.source_feed WHERE account=a
 ON CONFLICT DO NOTHING;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS source_capture ON mail_store.message;
CREATE TRIGGER source_capture AFTER INSERT OR UPDATE OR DELETE ON mail_store.message
 FOR EACH ROW EXECUTE FUNCTION mail_store.source_capture();
DROP TRIGGER IF EXISTS source_membership_capture ON mail_store.gmail_uid;
CREATE TRIGGER source_membership_capture AFTER INSERT OR UPDATE OR DELETE ON mail_store.gmail_uid
 FOR EACH ROW EXECUTE FUNCTION mail_store.source_capture();
CREATE OR REPLACE FUNCTION mail_store.source_folder_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.role=OLD.role
    AND (NEW.state->'epoch') IS NOT DISTINCT FROM (OLD.state->'epoch')
    AND NOT (COALESCE((OLD.state->>'older')::bigint,0)>0 AND COALESCE((NEW.state->>'older')::bigint,0)=0) THEN
   RETURN NULL;
 END IF;
 INSERT INTO mail_store.source_dirty
 SELECT f.id,m.message_id FROM mail_store.source_feed f JOIN mail_store.message m ON m.account=f.account
 WHERE f.account=COALESCE(NEW.account,OLD.account) AND f.folder_id=COALESCE(NEW.folder_id,OLD.folder_id)
 UNION SELECT f.id,h.message_id FROM mail_store.source_feed f JOIN mail_store.source_head h ON h.feed_id=f.id
 WHERE f.account=COALESCE(NEW.account,OLD.account) AND f.folder_id=COALESCE(NEW.folder_id,OLD.folder_id)
 ON CONFLICT DO NOTHING;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS source_folder_capture ON mail_store.folder;
CREATE TRIGGER source_folder_capture AFTER INSERT OR UPDATE OR DELETE ON mail_store.folder
 FOR EACH ROW EXECUTE FUNCTION mail_store.source_folder_capture();

ALTER TABLE mail_store.source_feed ADD COLUMN IF NOT EXISTS acknowledged_coverage text;
CREATE INDEX IF NOT EXISTS source_head_message ON mail_store.source_head(feed_id,message_id);
CREATE INDEX IF NOT EXISTS source_change_feed_order ON mail_store.source_change(feed_id,sequence);
