import json, os, sys
sys.path.insert(0,'server/src')
from business_bridge_direct.protocol_crypto import *
def test_canonical_and_b64():
    assert canonical({'z':1,'a':'ю'}) == '{"a":"ю","z":1}'.encode()
    x=os.urandom(32); assert unb64(b64u(x))==x
def test_signature_low_s():
    k=ec.generate_private_key(ec.SECP256R1()); s=sign(k,b'BB2D'); verify(k.public_key(),s,b'BB2D'); assert len(unb64(s))==64
def test_aes_roundtrip():
    k=os.urandom(32); n=os.urandom(12); a=b'aad'; c=aes_encrypt(k,n,b'probe',a); assert aes_decrypt(k,n,c,a)==b'probe'
