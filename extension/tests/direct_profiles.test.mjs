import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { ROOT } from './helpers.mjs';

function runtime() {
  const context = {
    crypto: crypto.webcrypto, TextEncoder, TextDecoder, console,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
  };
  context.globalThis = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'shared/direct_profiles.js'), 'utf8'), context);
  return context.BB2Direct;
}
function b64u(value) { return Buffer.from(new Uint8Array(value)).toString('base64url'); }
async function fixture() {
  const D = runtime();
  const server = await crypto.webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.webcrypto.subtle.exportKey('spki', server.publicKey));
  const fp = Buffer.from(new Uint8Array(await crypto.webcrypto.subtle.digest('SHA-256', spki))).toString('hex');
  const device = await D.generateDeviceIdentity();
  const profile = {
    profile_id: 'direct-profile-11111111-1111-4111-8111-111111111111', kind: 'direct', profile_revision: 1,
    name: 'D', host: '78.17.68.165', port: 18100,
    server_instance_id: '22222222-2222-4222-8222-222222222222', server_fingerprint: `sha256:${fp}`,
    server_public_key: b64u(spki), rotation_generation: 1,
    device_id: '33333333-3333-4333-8333-333333333333', device_status: 'ACTIVE', connection_state: 'CONNECTED',
  };
  return { D, server, device, profile };
}

test('D01 device key generation exports SPKI/PKCS8 but public profile contains no private material', async () => {
  const { D, device, profile } = await fixture();
  assert.match(device.public_key, /^[A-Za-z0-9_-]+$/); assert.match(device.private_key, /^[A-Za-z0-9_-]+$/);
  const pub = D.publicProfile(profile, true);
  assert.equal(pub.has_private_key, true);
  assert.equal(Object.prototype.hasOwnProperty.call(pub, 'private_key'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(pub, 'server_public_key'), false);
});

test('D02 lifecycle request is signed over frozen BB2D-L1 client transcript', async () => {
  const { D, device, profile } = await fixture();
  const privateKey = await D.importDevicePrivateKey(device.private_key);
  const request = await D.lifecycleRequest(profile, privateKey, 'status', Date.parse('2026-08-02T10:00:00Z'));
  assert.equal(request.lifecycle_version, 'BB2D-L1'); assert.equal(request.action, 'status');
  assert.equal(request.timestamp, '2026-08-02T10:00:00Z'); assert.equal(request.expires_at, '2026-08-02T10:00:30Z');
  assert.equal(new Set(Object.keys(request)).size, 7);
});

test('D03 server lifecycle signature verifies only for pinned instance/fingerprint/key', async () => {
  const { D, server, device, profile } = await fixture();
  const privateKey = await D.importDevicePrivateKey(device.private_key);
  const now = Date.parse('2026-08-02T10:00:00Z');
  const request = await D.lifecycleRequest(profile, privateKey, 'status', now);
  const response = {
    lifecycle_version: 'BB2D-L1', action: 'status', device_id: profile.device_id,
    instance_id: profile.server_instance_id, server_fingerprint: profile.server_fingerprint,
    request_id: request.request_id, status: 'ACTIVE', timestamp: '2026-08-02T10:00:00Z', expires_at: '2026-08-02T10:01:00Z',
  };
  response.signature = await D.sign(server.privateKey, D.domain('BB2D-L1/server-device', D.canonical({ method: 'POST', path: '/v2/pairing/device', status: 200, response })));
  const verified = await D.verifyLifecycleResponse(profile, request, response, now);
  assert.equal(verified.status, 'ACTIVE');
  await assert.rejects(() => D.verifyLifecycleResponse({ ...profile, server_fingerprint: `sha256:${'0'.repeat(64)}` }, request, response, now), /server_identity_changed/);
  await assert.rejects(() => D.verifyLifecycleResponse(profile, request, { ...response, status: 'REVOKED' }, now), /invalid_server_signature/);
});

test('D04 Direct origin accepts canonical IPv4 only and lifecycle response enforces expiry', async () => {
  const { D, server, device, profile } = await fixture();
  assert.equal(D.directOrigin('78.17.68.165', 18100), 'http://78.17.68.165:18100');
  assert.throws(() => D.directOrigin('078.17.68.165', 18100), /invalid_host/);
  const privateKey = await D.importDevicePrivateKey(device.private_key);
  const request = await D.lifecycleRequest(profile, privateKey, 'status', Date.parse('2026-08-02T10:00:00Z'));
  const response = { lifecycle_version:'BB2D-L1', action:'status', device_id:profile.device_id, instance_id:profile.server_instance_id, server_fingerprint:profile.server_fingerprint, request_id:request.request_id, status:'ACTIVE', timestamp:'2026-08-02T09:59:00Z', expires_at:'2026-08-02T10:00:00Z' };
  response.signature = await D.sign(server.privateKey, D.domain('BB2D-L1/server-device', D.canonical({method:'POST',path:'/v2/pairing/device',status:200,response})));
  await assert.rejects(() => D.verifyLifecycleResponse(profile, request, response, Date.parse('2026-08-02T10:00:00Z')), /invalid_lifecycle_response_time/);
});
