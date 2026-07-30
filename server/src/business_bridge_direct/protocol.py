"""BB2D-P1 session and protected synthetic probe implementation."""
from __future__ import annotations
import hashlib, secrets, threading, uuid, json
from datetime import datetime, timezone, timedelta
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.exceptions import InvalidSignature
from .protocol_crypto import *
from .database import _connect, utc_now
from . import tasks as task_store

PV='BB2D-P1'; SESSION_FIELDS={'protocol_version','device_id','client_ephemeral_public_key','client_nonce','request_id','timestamp','expires_at','signature'}
ENV_FIELDS={'protocol_version','session_id','device_id','request_id','sequence','timestamp','expires_at','nonce','ciphertext','signature'}
UUID4=lambda x: isinstance(x,str) and str(uuid.UUID(x))==x and uuid.UUID(x).version==4 and x==x.lower()
def ts(x):
    try:
        d=datetime.fromisoformat(x.replace('Z','+00:00'))
        if d.tzinfo is None or not x.endswith('Z') or d.microsecond or d.isoformat(timespec='seconds').replace('+00:00','Z')!=x: raise ValueError
        return d
    except Exception as e: raise ValueError('invalid_timestamp') from e
def now(): return datetime.now(timezone.utc).replace(microsecond=0)
def check_time(a,b,maximum=60):
    x,y=ts(a),ts(b); n=now()
    if y<x or (y-x).total_seconds()>maximum: raise ValueError('expired_message')
    if abs((n-x).total_seconds())>30: raise ValueError('invalid_timestamp')
def domain(prefix: str, data: bytes) -> bytes: return prefix.encode()+b'\0'+data
class Protocol:
    def __init__(self, service): self.service=service; self.lock=threading.RLock(); self.sessions={}
    def _server_key(self):
        return serialization.load_pem_private_key(open(self.service.config.server_signing_private_key_path,'rb').read(),None)
    def session(self, body: bytes) -> tuple[int,dict]:
        q=parse_json(body,SESSION_FIELDS)
        if q['protocol_version']!=PV: raise ValueError('unsupported_protocol_version')
        if not UUID4(q['device_id']) or not UUID4(q['request_id']): raise ValueError('malformed_request')
        check_time(q['timestamp'],q['expires_at'])
        client_key,client_der=load_p256_spki(q['client_ephemeral_public_key']); unb64(q['client_nonce'],32)
        c=_connect(self.service.database_path)
        row=c.execute('SELECT public_key_spki,status FROM paired_devices WHERE device_id=?',(q['device_id'],)).fetchone(); c.close()
        if not row: raise ValueError('unknown_device')
        if row[1]!='ACTIVE': raise ValueError('device_revoked')
        try:
            device_key,_=load_p256_spki(row[0]); verify(device_key,q['signature'],domain('BB2D-P1/client-session',canonical({k:q[k] for k in q if k!='signature'})))
        except InvalidSignature as e: raise ValueError('invalid_signature') from e
        except ValueError as e:
            if str(e) in ('wrong_curve','malformed_signature','invalid_signature'): raise
            raise ValueError('invalid_signature') from e
        with self.lock:
            c=_connect(self.service.database_path)
            if c.execute('SELECT 1 FROM protocol_sessions WHERE handshake_request_id=?',(q['request_id'],)).fetchone(): c.close(); raise ValueError('replay_detected')
            sid=str(uuid.uuid4()); server_nonce=secrets.token_bytes(32); eph=ec.generate_private_key(ec.SECP256R1()); server_der=eph.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)
            ident=self.service.identity; t=utc_now(); exp=(now()+timedelta(minutes=15)).isoformat().replace('+00:00','Z')
            resp={'protocol_version':PV,'session_id':sid,'instance_id':ident['instance_id'],'server_fingerprint':ident['fingerprint'],'server_ephemeral_public_key':b64u(server_der),'server_nonce':b64u(server_nonce),'request_id':q['request_id'],'timestamp':t,'expires_at':exp}
            digest=hashlib.sha256(canonical({k:q[k] for k in q if k!='signature'})).hexdigest()
            resp['signature']=sign(self._server_key(),domain('BB2D-P1/server-session',canonical({'client_request_sha256':digest,'response':resp})))
            shared=eph.exchange(ec.ECDH(),client_key); info=length_info([PV,ident['instance_id'],ident['fingerprint'],q['device_id'],sid,hashlib.sha256(client_der).hexdigest(),hashlib.sha256(server_der).hexdigest(),q['request_id']]); out=hkdf(shared,hashlib.sha256(unb64(q['client_nonce'])+server_nonce).digest(),info)
            c.execute('BEGIN IMMEDIATE'); c.execute("INSERT INTO protocol_sessions VALUES(?,?,?,?,?,?,?,?,?)",(sid,q['device_id'],PV,t,exp,q['request_id'],'ACTIVE',0,0)); c.commit(); c.close()
            self.sessions[sid]=(q['device_id'],out[:32],out[32:],eph)
            return 200,resp
    def probe(self, body: bytes) -> tuple[int,dict]:
        q=parse_json(body,ENV_FIELDS)
        if q['protocol_version']!=PV: raise ValueError('unsupported_protocol_version')
        if not UUID4(q['session_id']) or not UUID4(q['device_id']) or not UUID4(q['request_id']) or type(q['sequence']) is not int or q['sequence']<1: raise ValueError('malformed_request')
        check_time(q['timestamp'],q['expires_at']); nonce=unb64(q['nonce'],12); ciphertext=unb64(q['ciphertext'])
        with self.lock:
            s=self.sessions.get(q['session_id'])
            if not s: raise ValueError('rekey_required')
            did,c2s,s2c,_=s
            if did!=q['device_id']: raise ValueError('unknown_session')
            c=_connect(self.service.database_path); row=c.execute('SELECT paired_devices.status,protocol_sessions.receive_sequence FROM paired_devices JOIN protocol_sessions USING(device_id) WHERE protocol_sessions.session_id=?',(q['session_id'],)).fetchone()
            if not row: c.close(); raise ValueError('unknown_session')
            if row[0]!='ACTIVE': c.close(); raise ValueError('device_revoked')
            if q['sequence']!=row[1]+1: c.close(); raise ValueError('sequence_violation')
            aad=canonical({'direction':'client-to-server','method':'POST','path':'/v2/protocol/probe','protocol_version':PV,'session_id':q['session_id'],'device_id':did,'request_id':q['request_id'],'sequence':q['sequence'],'timestamp':q['timestamp'],'expires_at':q['expires_at'],'nonce':q['nonce']})
            device=c.execute('SELECT public_key_spki FROM paired_devices WHERE device_id=?',(did,)).fetchone()[0]; key,_=load_p256_spki(device)
            try: verify(key,q['signature'],domain('BB2D-P1/client-probe',aad+b'\0'+nonce+b'\0'+ciphertext)); plain=aes_decrypt(c2s,nonce,ciphertext,aad)
            except (InvalidSignature,ValueError): c.close(); raise ValueError('authentication_failed')
            p=parse_json(plain,{'type','probe_id','synthetic_payload'})
            if p['type']!='protocol_probe' or not UUID4(p['probe_id']) or not isinstance(p['synthetic_payload'],str) or not p['synthetic_payload']: c.close(); raise ValueError('invalid_plaintext')
            c.execute('BEGIN IMMEDIATE'); c.execute('UPDATE protocol_sessions SET receive_sequence=receive_sequence+1 WHERE session_id=? AND receive_sequence=?',(q['session_id'],q['sequence']-1)); c.execute('INSERT INTO protocol_replay VALUES(?,?,?,?,?,?)',(q['session_id'],'c2s',q['request_id'],hashlib.sha256(nonce).hexdigest(),q['sequence'],utc_now())); c.commit(); c.close()
            out={'type':'protocol_probe_result','probe_id':p['probe_id'],'synthetic_payload_sha256':hashlib.sha256(p['synthetic_payload'].encode()).hexdigest(),'accepted_at':utc_now()}; rn=secrets.token_bytes(12); ra=canonical({'direction':'server-to-client','method':'POST','path':'/v2/protocol/probe','status':200,'protocol_version':PV,'session_id':q['session_id'],'device_id':did,'request_id':q['request_id'],'sequence':q['sequence'],'timestamp':out['accepted_at'],'expires_at':q['expires_at'],'nonce':b64u(rn)}); ct=aes_encrypt(s2c,rn,canonical(out),ra); env={'protocol_version':PV,'session_id':q['session_id'],'device_id':did,'request_id':q['request_id'],'sequence':q['sequence'],'timestamp':out['accepted_at'],'expires_at':q['expires_at'],'nonce':b64u(rn),'ciphertext':b64u(ct)}; env['signature']=sign(self._server_key(),domain('BB2D-P1/server-probe',canonical({'aad':ra.decode(),'envelope':env}))); return 200,env

    def tasks(self, body: bytes) -> tuple[int, dict]:
        """Authenticate one BB2D-P1 envelope, then process an application message."""
        q = parse_json(body, ENV_FIELDS)
        if q['protocol_version'] != PV or not UUID4(q['session_id']) or not UUID4(q['device_id']) or not UUID4(q['request_id']) or type(q['sequence']) is not int or q['sequence'] < 1:
            raise ValueError('malformed_request')
        check_time(q['timestamp'], q['expires_at']); nonce = unb64(q['nonce'], 12); ciphertext = unb64(q['ciphertext'])
        path = '/v2/protocol/tasks'
        with self.lock:
            s = self.sessions.get(q['session_id'])
            if not s: raise ValueError('rekey_required')
            did, c2s, s2c, _ = s
            if did != q['device_id']: raise ValueError('unknown_session')
            c = _connect(self.service.database_path)
            row = c.execute('SELECT paired_devices.status,protocol_sessions.receive_sequence,paired_devices.public_key_spki FROM paired_devices JOIN protocol_sessions USING(device_id) WHERE protocol_sessions.session_id=?', (q['session_id'],)).fetchone()
            if not row: c.close(); raise ValueError('unknown_session')
            if row[0] != 'ACTIVE': c.close(); raise ValueError('device_revoked')
            if q['sequence'] != row[1] + 1: c.close(); raise ValueError('sequence_violation')
            aad = canonical({'direction':'client-to-server','method':'POST','path':path,'protocol_version':PV,'session_id':q['session_id'],'device_id':did,'request_id':q['request_id'],'sequence':q['sequence'],'timestamp':q['timestamp'],'expires_at':q['expires_at'],'nonce':q['nonce']})
            key, _ = load_p256_spki(row[2])
            try:
                verify(key, q['signature'], domain('BB2D-P1/client-tasks', aad + b'\0' + nonce + b'\0' + ciphertext))
                plain = aes_decrypt(c2s, nonce, ciphertext, aad)
            except (InvalidSignature, ValueError): c.close(); raise ValueError('authentication_failed')
            try:
                p = json.loads(plain.decode('utf-8'))
                if not isinstance(p, dict) or p.get('type') not in {'task_create','task_status','task_cancel','task_report'}:
                    raise ValueError('invalid_task_request')
                expected = {'task_create': {'type','operation_id','task_payload','execution_mode'}, 'task_status': {'type','task_id'}, 'task_cancel': {'type','task_id'}, 'task_report': {'type','task_id'}}[p['type']]
                if set(p) != expected: raise ValueError('invalid_task_request')
                if p['type'] != 'task_create': task_store._uuid4(p.get('task_id'))
                if p['type'] == 'task_create': result, error = task_store.create(self.service.database_path, did, p)
                elif p['type'] == 'task_status': result, error = task_store.lookup(self.service.database_path, did, p['task_id']), None
                elif p['type'] == 'task_cancel': result, error = task_store.cancel(self.service.database_path, did, p['task_id'])
                else: result, error = task_store.report(self.service.database_path, did, p['task_id'])
                if error: raise ValueError(error)
                result = {'type':'task_response','result':result}
                status = 200
            except (ValueError, json.JSONDecodeError) as exc:
                result = {'type':'task_error','error':str(exc) if str(exc) in {'invalid_task_request','operation_payload_conflict','task_not_found','not_cancellable','report_not_available'} else 'invalid_task_request'}
                status = 409 if result['error'] == 'operation_payload_conflict' else 404 if result['error'] in {'task_not_found','report_not_available'} else 409 if result['error'] == 'not_cancellable' else 400
            c.execute('BEGIN IMMEDIATE'); c.execute('UPDATE protocol_sessions SET receive_sequence=receive_sequence+1 WHERE session_id=? AND receive_sequence=?', (q['session_id'], q['sequence']-1)); c.execute('INSERT INTO protocol_replay VALUES(?,?,?,?,?,?)', (q['session_id'],'c2s',q['request_id'],hashlib.sha256(nonce).hexdigest(),q['sequence'],utc_now())); c.commit(); c.close()
            timestamp = utc_now(); rn = secrets.token_bytes(12)
            response_aad = canonical({'direction':'server-to-client','method':'POST','path':path,'status':status,'protocol_version':PV,'session_id':q['session_id'],'device_id':did,'request_id':q['request_id'],'sequence':q['sequence'],'timestamp':timestamp,'expires_at':q['expires_at'],'nonce':b64u(rn)})
            response_env = {'protocol_version':PV,'session_id':q['session_id'],'device_id':did,'request_id':q['request_id'],'sequence':q['sequence'],'timestamp':timestamp,'expires_at':q['expires_at'],'nonce':b64u(rn),'ciphertext':b64u(aes_encrypt(s2c, rn, canonical(result), response_aad))}
            response_env['signature'] = sign(self._server_key(), domain('BB2D-P1/server-tasks', canonical({'aad':response_aad.decode(), 'envelope':response_env})))
            return status, response_env
