"""Recover public keys from published compact signatures; never handles private keys."""
import base64, hashlib, json
from pathlib import Path

P=2**256-2**32-977
N=0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G=(0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
   0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)

def add(a,b):
    if a is None:return b
    if b is None:return a
    x,y=a;u,v=b
    if x==u and (y+v)%P==0:return None
    m=((3*x*x)*pow(2*y,-1,P) if a==b else (v-y)*pow(u-x,-1,P))%P
    w=(m*m-x-u)%P
    return w,(m*(x-w)-y)%P

def mul(k,a):
    result=None
    while k:
        if k&1:result=add(result,a)
        a=add(a,a);k>>=1
    return result

def sha256d(value):return hashlib.sha256(hashlib.sha256(value).digest()).digest()
def compact(value):
    assert 0<=value<253
    return bytes([value])
def encoded_magic(text):
    raw=text.encode();return compact(len(raw))+raw
def address_hash(address):
    alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';number=0
    for c in address:number=number*58+alphabet.index(c)
    raw=number.to_bytes(26,'big')
    assert raw[:2]==bytes.fromhex('1cb8') and sha256d(raw[:-4])[:4]==raw[-4:]
    return raw[2:-4]

def recover(signature,digest):
    raw=base64.b64decode(signature,validate=True);assert len(raw)==65
    code=raw[0]-27;assert 0<=code<=7
    compressed=bool(code&4);recovery=code&3
    r=int.from_bytes(raw[1:33],'big');s=int.from_bytes(raw[33:],'big')
    assert 1<=r<N and 1<=s<N
    x=r+(recovery//2)*N
    if x>=P:return None
    y=pow((x*x*x+7)%P,(P+1)//4,P)
    if (y*y-x*x*x-7)%P:return None
    if y%2!=recovery%2:y=P-y
    point=(x,y)
    if mul(N,point) is not None:return None
    z=int.from_bytes(digest,'big')
    public=mul(pow(r,-1,N),add(mul(s,point),mul((-z)%N,G)))
    if public is None:return None
    # Independently check the ECDSA equation using the recovered point.
    w=pow(s,-1,N);check=add(mul((z*w)%N,G),mul((r*w)%N,public))
    assert check is not None and check[0]%N==r
    a,b=public
    return (bytes([2+b%2])+a.to_bytes(32,'big')) if compressed else b'\x04'+a.to_bytes(32,'big')+b.to_bytes(32,'big')

def main():
    root=Path(__file__).parent
    data=json.loads((root/'public-signatures.json').read_text())
    message=data['message'].encode('utf8');assert message==b'NonKYC Cryptocurrency Exchange'
    conventions={
      'zclassic-native':encoded_magic('Zclassic Signed Message:\n'),
      'bitcoin-native':encoded_magic('Bitcoin Signed Message:\n'),
      'zcash-native':encoded_magic('Zcash Signed Message:\n'),
      'legacy-electrum-zcl-literal':b'\x19Zcash Signed Message:\n',
      'community-electrum-zcl-literal':b'\x18Zclassic Signed Message:\n',
    }
    rows=[]
    for item in data['addresses']:
        matches=[]
        for name,prefix in conventions.items():
            digest=sha256d(prefix+compact(len(message))+message)
            public=recover(item['signature'],digest)
            if public and hashlib.new('ripemd160',hashlib.sha256(public).digest()).digest()==address_hash(item['address']):
                matches.append({'convention':name,'publicKeyHex':public.hex(),'digestHex':digest.hex(),'prefixHex':prefix.hex()})
        rows.append({'address':item['address'],'matches':matches})
    report={'message':data['message'],'conventions':{k:v.hex() for k,v in conventions.items()},'results':rows}
    (root/'alternate-signature-verification.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({'addresses':len(rows),'matches':{name:sum(any(m['convention']==name for m in row['matches']) for row in rows) for name in conventions}},indent=2))

if __name__=='__main__':main()
