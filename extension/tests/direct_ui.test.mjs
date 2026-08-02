import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROOT, readContentSource, readPopupSource } from './helpers.mjs';
const workerSource = () => ['worker/part1.js','worker/part2.js','worker/part3.js','worker/part4.js','worker/part5.js','worker/part6.js','worker/part7.js','worker/part8.js','worker/part9.js','worker/part10.js','worker/part11.js','worker/part12.js'].map((part) => fs.readFileSync(`${ROOT}/${part}`, 'utf8')).join('\n');
const read = (name) => name === 'service_worker.js' ? workerSource() : name === 'content_script.js' ? readContentSource() : name === 'popup.js' ? readPopupSource() : fs.readFileSync(`${ROOT}/${name}`, 'utf8');

test('U11-01 Direct UI requires preview plus explicit identity confirmation before pairing', () => {
  const html = read('popup.html'), js = read('popup.js');
  for (const id of ['directBundle','directPreview','directIdentityConfirm','pairDirectProfile']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(js, /decodeBundle\(raw/); assert.match(js, /directIdentityConfirm/); assert.match(js, /pairDirectProfile"\)\.disabled/);
});

test('U11-02 revoke, disconnect and local delete are visibly distinct actions', () => {
  const html = read('popup.html'), js = read('popup.js');
  assert.match(html, /Отключить/); assert.match(html, /Отозвать устройство/); assert.match(html, /Удалить локально/);
  assert.match(js, /BB2_DIRECT_DISCONNECT/); assert.match(js, /BB2_DIRECT_REVOKE/); assert.match(js, /BB2_DIRECT_DELETE/);
});

test('U11-03 arbitrary Direct permission is optional while Legacy host permissions stay unchanged', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*']);
  assert.ok(manifest.host_permissions.includes('http://127.0.0.1/*'));
  assert.ok(manifest.host_permissions.includes('http://localhost/*'));
  assert.equal(manifest.host_permissions.includes('http://*/*'), false);
  assert.match(read('popup.js'), /chrome\.permissions\.request/);
});

test('U11-04 Direct key code is not loaded into ChatGPT page context and task transport is not implemented early', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const pageScripts = manifest.content_scripts.flatMap((entry) => entry.js || []);
  assert.equal(pageScripts.includes('shared/direct_profiles.js'), false);
  const worker = read('service_worker.js');
  assert.match(worker, /DIRECT_PRIVATE_KEYS/);
  assert.match(worker, /TRUSTED_CONTEXTS/);
  assert.doesNotMatch(worker, /BB2_DIRECT_TASK/);
});

test('U11-05 current extension version and schema are run-11 synchronized', () => {
  assert.equal(JSON.parse(read('manifest.json')).version, '2.0.0.21');
  assert.equal(JSON.parse(read('package.json')).version, '2.0.0.21');
  assert.match(read('service_worker.js'), /RUNTIME_VERSION = "2\.0\.0\.21"/);
  assert.match(read('service_worker.js'), /SETTINGS_SCHEMA_VERSION = 5/);
});
