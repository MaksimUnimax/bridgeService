import hashlib, json, os, pathlib, sys
sys.path.insert(0,'server/src')
from business_bridge_direct.protocol_crypto import *
from business_bridge_direct.protocol import domain
def test_canonical_and_b64():
    assert canonical({'z':1,'a':'ю'}) == '{"a":"ю","z":1}'.encode()
    x=os.urandom(32); assert unb64(b64u(x))==x
def test_signature_low_s():
    k=ec.generate_private_key(ec.SECP256R1()); s=sign(k,b'BB2D'); verify(k.public_key(),s,b'BB2D'); assert len(unb64(s))==64
def test_aes_roundtrip():
    k=os.urandom(32); n=os.urandom(12); a=b'aad'; c=aes_encrypt(k,n,b'probe',a); assert aes_decrypt(k,n,c,a)==b'probe'
def test_webcrypto_combined_ciphertext_tag_contract():
    k=os.urandom(32); n=os.urandom(12); a=b'canonical-aad'; combined=aes_encrypt(k,n,b'chrome-probe',a)
    ciphertext,tag=split_gcm(combined)
    assert len(tag)==16 and len(ciphertext)==len(b'chrome-probe')
    assert join_gcm(ciphertext,tag)==combined
    assert aes_decrypt(k,n,join_gcm(ciphertext,tag),a)==b'chrome-probe'

def test_published_browser_vectors_match_server_canonicalization():
    path = pathlib.Path(__file__).parents[2] / 'docs/development/evidence/BB2-DIRECT-08-SRV_BROWSER_VECTORS.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    text = path.read_text(encoding='utf-8').lower()
    for forbidden in ('private_key', 'symmetric_key', 'pairing_code', 'traffic_key', 'session_key', 'ciphertext', 'production'):
        assert forbidden not in text
    for item in data['application_messages'] + [data['client_aad']] + data['server_aad_statuses']:
        raw = canonical(item['canonical'])
        assert raw.hex() == item['canonical_utf8_hex']
        assert len(raw) == item['byte_length']
        assert hashlib.sha256(raw).hexdigest() == item['sha256']
        assert sorted(item['canonical']) == item['expected_field_set']
    for item in data['domain_separation']:
        raw = domain(item['prefix'], canonical(item['transcript']))
        assert raw.hex() == item['bytes_hex']
        assert len(raw) == item['byte_length']
        assert hashlib.sha256(raw).hexdigest() == item['sha256']
