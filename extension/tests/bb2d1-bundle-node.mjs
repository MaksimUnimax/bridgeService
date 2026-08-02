import assert from 'node:assert/strict';
import {decodeBundle, BundleError} from '../protocol/bb2d1-bundle.js';

const positive = 'BB2D1.eyJidW5kbGVfdmVyc2lvbiI6IkJCMkQxIiwiZXhwaXJlc19hdCI6IjIwMjYtMDctMzBUMDA6MTA6MDBaIiwiaG9zdCI6Ijc4LjE3LjY4LjE2NSIsImluc3RhbmNlX2lkIjoiMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExIiwiaXNzdWVkX2F0IjoiMjAyNi0wNy0zMFQwMDowMDowMFoiLCJwYWlyaW5nX2NvZGUiOiIwMTIzNDU2Nzg5YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZiIsInBhaXJpbmdfc2Vzc2lvbl9pZCI6IjIyMjIyMjIyLTIyMjItNDIyMi04MjIyLTIyMjIyMjIyMjIyMiIsInBvcnQiOjE4MTAwLCJyb3RhdGlvbl9nZW5lcmF0aW9uIjoxLCJzZXJ2ZXJfZmluZ2VycHJpbnQiOiJzaGEyNTY6MTBhNTE3YTU0YTdmYTYyNWEyZTQ2YWQyMTllNDIzZTllMTg1YjUwYzViMjcwYzBlMTc1NWQ0NTdmMmNlMGZhYiIsInNlcnZlcl9wdWJsaWNfa2V5IjoiTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFZGFqc2MwTUtXUEduOEpsQXZkMWlRVEVEOHdnREhZRjIzSGVxMXNNLTVlTDYxekZoS0hld0Y5SG9Nc0UzR0NEMi1aT1VhM3o1WEpTNHJwR1U5eUNDMGciLCJzZXJ2ZXJfcHVibGljX2tleV9mb3JtYXQiOiJTUEtJX0RFUl9CQVNFNjRVUkwiLCJzZXJ2ZXJfc2lnbmluZ19hbGdvcml0aG0iOiJFQ0RTQV9QMjU2X1NIQTI1NiJ9.zTKu--COziZslQDNS25gf8D9Fc6CHCkyUpJqWbvXA3c';

const decoded = await decodeBundle(positive, {now: '2026-07-30T00:00:00Z'});
assert.equal(decoded.host, '78.17.68.165');
assert.equal(decoded.port, 18100);
assert.equal(decoded.bundle_version, 'BB2D1');

for (const bad of [
  '',
  positive + '.extra',
  positive.replace('BB2D1.', 'BB2D2.'),
  positive.replace(/.$/, 'A'),
  positive.replace('.', '.\n'),
  'B'.repeat(4097),
]) {
  await assert.rejects(() => decodeBundle(bad, {now: '2026-07-30T00:00:00Z'}), BundleError);
}
await assert.rejects(() => decodeBundle(positive, {now: '2026-07-30T00:10:00Z'}), /expired_bundle/);
console.log(JSON.stringify({pass: true, positive: 1, synthetic_negative: 7}));
