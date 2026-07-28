"""Canonical, browser-compatible BB2D-P1 cryptographic primitives."""
from __future__ import annotations
import base64, hashlib, json, re
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

ORDER = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
HALF_ORDER = ORDER // 2
B64 = re.compile(r'^[A-Za-z0-9_-]+$')

def b64u(data: bytes) -> str: return base64.urlsafe_b64encode(data).decode().rstrip('=')
def unb64(value: str, size: int|None=None) -> bytes:
    if not isinstance(value, str) or not value or '=' in value or not B64.fullmatch(value): raise ValueError('malformed_base64')
    try: data=base64.urlsafe_b64decode(value+'='*((4-len(value)%4)%4))
    except Exception as e: raise ValueError('malformed_base64') from e
    if b64u(data)!=value or size is not None and len(data)!=size: raise ValueError('malformed_base64')
    return data

def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',',':'), allow_nan=False).encode('utf-8')

def parse_json(data: bytes, fields: set[str]) -> dict:
    def pairs(items):
        d={}
        for k,v in items:
            if k in d: raise ValueError('duplicate_json_key')
            d[k]=v
        return d
    try: obj=json.loads(data.decode('utf-8'), object_pairs_hook=pairs, parse_constant=lambda x: (_ for _ in ()).throw(ValueError('nonfinite')))
    except Exception as e: raise ValueError('malformed_request') from e
    if not isinstance(obj,dict) or set(obj)!=fields: raise ValueError('unknown_or_missing_field')
    return obj

def load_p256_spki(value: str) -> tuple[ec.EllipticCurvePublicKey, bytes]:
    der=unb64(value)
    try: key=serialization.load_der_public_key(der)
    except Exception as e: raise ValueError('wrong_curve') from e
    if not isinstance(key,ec.EllipticCurvePublicKey) or not isinstance(key.curve,ec.SECP256R1): raise ValueError('wrong_curve')
    if key.public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)!=der: raise ValueError('wrong_curve')
    return key,der

def p1363_from_der(der: bytes) -> bytes:
    r,s=utils.decode_dss_signature(der)
    if s>HALF_ORDER: s=ORDER-s
    return r.to_bytes(32,'big')+s.to_bytes(32,'big')
def der_from_p1363(raw: bytes) -> bytes:
    if len(raw)!=64: raise ValueError('malformed_signature')
    r=int.from_bytes(raw[:32],'big'); s=int.from_bytes(raw[32:],'big')
    if not (0<r<ORDER and 0<s<=HALF_ORDER): raise ValueError('invalid_signature')
    return utils.encode_dss_signature(r,s)
def sign(key, data: bytes) -> str:
    return b64u(p1363_from_der(key.sign(data,ec.ECDSA(hashes.SHA256()))))
def verify(key, value: str, data: bytes) -> None:
    raw=unb64(value,64); key.verify(der_from_p1363(raw),data,ec.ECDSA(hashes.SHA256()))

def hkdf(shared: bytes, salt: bytes, info: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(),length=64,salt=salt,info=info).derive(shared)
def length_info(parts: list[str]) -> bytes:
    return b''.join(len(p.encode()).to_bytes(4,'big')+p.encode() for p in parts)
def aes_encrypt(key: bytes, nonce: bytes, plaintext: bytes, aad: bytes) -> bytes: return AESGCM(key).encrypt(nonce,plaintext,aad)
def aes_decrypt(key: bytes, nonce: bytes, ciphertext: bytes, aad: bytes) -> bytes: return AESGCM(key).decrypt(nonce,ciphertext,aad)
