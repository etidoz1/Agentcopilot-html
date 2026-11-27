const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('contact redaction masks common international phone and email formats', () => {
  const source = read('payment-worker-staging.js');
  const declaration = source.match(/function redactContactText\(value\)\{[\s\S]*?\n\}/);
  assert.ok(declaration, 'redaction function must exist');
  const context = {};
  vm.createContext(context);
  vm.runInContext(declaration[0] + ';this.redact=redactContactText;', context);
  for (const input of ['+234 816 360 9815', '0816-360-9815', '+1 (202) 555-0199', 'owner@example.com']) {
    assert.match(context.redact(input), /contact protected/i, input);
  }
});

test('public property detail never serializes seller contact fields', () => {
  const payment = read('payment-worker-staging.js');
  assert.ok(payment.includes('const {seller_phone,seller_email,...publicProperty}=row'));
  assert.ok(payment.includes('property:publicProperty'));
  assert.ok(!payment.includes('return json({property:row,images:imgs.results||[]}'));
  const marketplace = read('worker.js');
  assert.ok(marketplace.includes('const {seller_phone,seller_email,...publicProperty}=row'));
});

test('Gemini listing generation requires a verified signed-in user', () => {
  for (const name of ['worker.js', 'payment-worker-staging.js']) {
    const source = read(name);
    assert.ok(source.includes('Please sign in to use listing generation.'), name);
  }
});

test('all checked-in application JavaScript parses as modules', () => {
  for (const name of ['worker.js','payment-worker-staging.js','marketplace.js','script.js','payments-staging.js','payment-result-staging.js']) {
    const temp = path.join(require('node:os').tmpdir(), 'agentcopilot-check-' + name + '.mjs');
    fs.writeFileSync(temp, read(name));
    const result = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' });
    fs.unlinkSync(temp);
    assert.equal(result.status, 0, name + ': ' + result.stderr);
  }
});


test('package manifest and lockfile dependency declarations are consistent', () => {
  const manifest = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  assert.equal(manifest.scripts.test, 'node --test tests/*.test.cjs');
  const result = spawnSync(process.execPath, ['--check', path.join(root, 'server.js')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
