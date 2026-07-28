// Browser-only BB2D-P1 reference. No DOM, storage, privileged or Node APIs.
export const VERSION = 'BB2D-P1';
const te = new TextEncoder();
export const b64u = b => { let s=''; for(const x of new Uint8Array(b)) s+=String.fromCharCode(x); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); };
export const unb64 = s => { if(typeof s!=='string'||!s||s.includes('=')||!/^[A-Za-z0-9_-]+$/.test(s)) throw Error('malformed_base64'); const z=s.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s.length+3)%4); const raw=atob(z); const out=Uint8Array.from(raw,c=>c.charCodeAt(0)); if(b64u(out)!==s) throw Error('malformed_base64'); return out; };
export const canonical = x => { const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v; return te.encode(JSON.stringify(sort(x))); };
export const sha256 = x => crypto.subtle.digest('SHA-256',x);
export async function generateSigningKey(){return crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);}
export async function generateEphemeral(){return crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);}
export const exportSpki = k => crypto.subtle.exportKey('spki',k);
export const importSpki = b => crypto.subtle.importKey('spki',b,{name:'ECDSA',namedCurve:'P-256'},true,['verify']);
export const importEcdhSpki = b => crypto.subtle.importKey('spki',b,{name:'ECDH',namedCurve:'P-256'},true,[]);
export const sign = (k,b) => crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},k,b);
export const verify = (k,s,b) => crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},k,s,b);
export const derive = (privateKey, publicKey) => crypto.subtle.deriveBits({name:'ECDH',public:publicKey},privateKey,256);
export const hkdf = (key,salt,info) => crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},key,512);
export const aesKey = raw => crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);
export const aesEncrypt = (k,n,p,a) => crypto.subtle.encrypt({name:'AES-GCM',iv:n,additionalData:a,tagLength:128},k,p);
export const aesDecrypt = (k,n,c,a) => crypto.subtle.decrypt({name:'AES-GCM',iv:n,additionalData:a,tagLength:128},k,c);
export const lengthInfo = parts => { const out=[]; for(const p of parts){const b=te.encode(p); out.push(new Uint8Array([b.length>>>24,b.length>>>16&255,b.length>>>8&255,b.length&255]),b);} const r=new Uint8Array(out.reduce((n,x)=>n+x.length,0)); let o=0; for(const x of out){r.set(x,o);o+=x.length;} return r; };
