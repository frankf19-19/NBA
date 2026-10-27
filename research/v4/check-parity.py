import json,numpy as np
from pathlib import Path
r=Path('research/v4');a=json.loads((r/'js-features.json').read_text());meta=json.loads(Path('research/v2/meta.json').read_text());x=np.array([e['x'] for e in a]);expected=np.load(r/'features.npz')['X'];assert [e['id'] for e in a]==[e['id'] for e in meta];diff=float(abs(x-expected).max());assert diff<1e-8,diff
m=json.loads(Path('robust-shadow.json').read_text());sy=np.load(r/'features.npz')['sy'];y=np.load(r/'features.npz')['y'];tr=(sy>=2023)&(sy<2027);co=[]
for k in range(6):
 A=expected[tr,k];s=A.std(0);s[s<1e-6]=1;B=A/s;pen=np.eye(8)*10;pen[0,0]=1e-8;co.append(np.linalg.solve(B.T@B+pen,B.T@y[tr])/s)
cd=float(abs(np.array(co)-m['coeff']).max());assert cd<1e-8,cd
print(json.dumps({'rows':len(a),'featureMaxDifference':diff,'coefficientMaxDifference':cd}))
