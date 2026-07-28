// Browser-only BB2D-P1 reference. No DOM, storage, privileged or Node APIs.
export const VERSION = 'BB2D-P1';
const te = new TextEncoder();
export const concatBytes = (...parts) => { const xs=parts.map(x=>new Uint8Array(x)); const out=new Uint8Array(xs.reduce((n,x)=>n+x.length,0)); let o=0; for(const x of xs){out.set(x,o);o+=x.length;} return out; };
export const b64u = b => { let s=''; for(const x of new Uint8Array(b)) s+=String.fromCharCode(x); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); };
export const unb64 = s => { if(typeof s!=='string'||!s||s.includes('=')||!/^[A-Za-z0-9_-]+$/.test(s)) throw Error('malformed_base64'); const z=s.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s.length+3)%4); const raw=atob(z); const out=Uint8Array.from(raw,c=>c.charCodeAt(0)); if(b64u(out)!==s) throw Error('malformed_base64'); return out; };
export const canonical = x => { const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v; return te.encode(JSON.stringify(sort(x))); };
export const sha256 = x => crypto.subtle.digest('SHA-256',x);
export async function generateSigningKey(){return crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);}
export async function generateEphemeral(){return crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);}
export const exportSpki = k => crypto.subtle.exportKey('spki',k);
export const importSpki = b => crypto.subtle.importKey('spki',b,{name:'ECDSA',namedCurve:'P-256'},true,['verify']);
export const importEcdhSpki = b => crypto.subtle.importKey('spki',b,{name:'ECDH',namedCurve:'P-256'},true,[]);
const P256_ORDER=0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n;
const P256_HALF_ORDER=P256_ORDER>>1n;
const uintToBig=x=>BigInt('0x'+[...new Uint8Array(x)].map(v=>v.toString(16).padStart(2,'0')).join(''));
const bigTo32=x=>{const h=x.toString(16).padStart(64,'0');const out=new Uint8Array(32);for(let i=0;i<32;i++)out[i]=parseInt(h.slice(i*2,i*2+2),16);return out;};
// Web Crypto ECDSA uses IEEE-P1363, but does not promise low-S.  The wire
// profile does, so canonicalize at the browser boundary before transport.
export const sign = async (k,b) => { const raw=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},k,b)); if(raw.length!==64) throw Error('invalid_ecdsa_encoding'); const r=uintToBig(raw.slice(0,32)); let s=uintToBig(raw.slice(32)); if(s>P256_HALF_ORDER)s=P256_ORDER-s; const out=new Uint8Array(64);out.set(bigTo32(r));out.set(bigTo32(s),32);return out; };
export const verify = (k,s,b) => crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},k,s,b);
export const derive = (privateKey, publicKey) => crypto.subtle.deriveBits({name:'ECDH',public:publicKey},privateKey,256);
export const hkdfKey = raw => crypto.subtle.importKey('raw',raw,{name:'HKDF'},false,['deriveBits']);
export const hkdf = (key,salt,info) => crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},key,512);
export const aesKey = raw => crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);
export const aesEncrypt = (k,n,p,a) => crypto.subtle.encrypt({name:'AES-GCM',iv:n,additionalData:a,tagLength:128},k,p);
export const aesDecrypt = (k,n,c,a) => crypto.subtle.decrypt({name:'AES-GCM',iv:n,additionalData:a,tagLength:128},k,c);
// Web Crypto returns ciphertext followed by the authentication tag.  The
// wire contract carries that combined value in one base64url field; callers
// must not encode or append the tag a second time.
export const GCM_TAG_BYTES = 16;
export const splitGcm = combined => { const b=new Uint8Array(combined); if(b.length<GCM_TAG_BYTES) throw Error('short_gcm_output'); return {ciphertext:b.slice(0,-GCM_TAG_BYTES),tag:b.slice(-GCM_TAG_BYTES)}; };
export const joinGcm = (ciphertext,tag) => { const c=new Uint8Array(ciphertext), t=new Uint8Array(tag); if(t.length!==GCM_TAG_BYTES) throw Error('invalid_gcm_tag'); const out=new Uint8Array(c.length+t.length); out.set(c); out.set(t,c.length); return out; };
export const aesEncryptWire = async (k,n,p,a) => new Uint8Array(await aesEncrypt(k,n,p,a));
export const aesDecryptWire = (k,n,combined,a) => aesDecrypt(k,n,combined,a);
export const lengthInfo = parts => { const out=[]; for(const p of parts){const b=te.encode(p); out.push(new Uint8Array([b.length>>>24,b.length>>>16&255,b.length>>>8&255,b.length&255]),b);} const r=new Uint8Array(out.reduce((n,x)=>n+x.length,0)); let o=0; for(const x of out){r.set(x,o);o+=x.length;} return r; };
