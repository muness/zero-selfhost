import assert from 'node:assert/strict';
import { partitionMailSource } from './mail-source.ts';
import { spawnSync } from 'node:child_process';

// The Python producer is the contract: compare complete bytes at multibyte boundaries.
const texts = ['', 'Subject: Receipt\nFrom: person@example.test\nDate: 2026-11-06T01:02:03.000001+00:00\n\n<script>literal</script>', 'a'.repeat(65535) + '🙂é汉'.repeat(30000)];
const python = spawnSync('python3', ['-c', `
import ast,json,sys
p='docker/self-host/source-connector/source_connector.py'
tree=ast.parse(open(p).read())
fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='partition')
ns={'MAX_TEXT':65536}
exec(compile(ast.Module(body=[fn],type_ignores=[]),p,'exec'),ns)
print(json.dumps([list(ns['partition'](t)) for t in json.load(sys.stdin)]))
`], { input: JSON.stringify(texts), encoding: 'utf8', maxBuffer: 5000000 });
assert.equal(python.status, 0, python.stderr);
const expected = JSON.parse(python.stdout);
texts.forEach((text, i) => {
  const parts = partitionMailSource(text);
  assert.deepEqual(parts, expected[i]);
  assert.equal(parts.join(''), text);
  assert.ok(parts.every(part => Buffer.byteLength(part) <= 65536));
});
console.log('Source parts match Python producer: empty, source headers, multibyte boundaries, lossless reconstruction.');
