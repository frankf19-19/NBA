import json,numpy as np
from pathlib import Path
R=Path('research/v15');z=np.load('research/v7/clean-reference.npz');Q=np.load(R/'probabilities.npy');s=z['sy'];y=z['y'];d=z['dates'];m=(s>=2021)&np.isfinite(Q).all((1,2));c=(np.minimum((abs(y).astype(int)-1)//5,5)+(y<0)*6).astype(int);loss=-np.log(np.maximum(Q[np.arange(len(y)),:,c],1e-8));names=json.loads((R/'results.json').read_text())['names'];days=sorted(set(d[m]));ns=np.array([((d==v)&m).sum() for v in days]);ix=np.random.default_rng(20261028).integers(0,len(days),(3000,len(days)));out={}
for k,name in enumerate(names[1:],1):
 delta=loss[:,k]-loss[:,0];ss=np.array([delta[(d==v)&m].sum() for v in days]);out[name]=dict(loglossDifference=float(delta[m].mean()),pairedDateCI95=np.quantile(ss[ix].sum(1)/ns[ix].sum(1),[.025,.975]).tolist(),hits=int((Q[m,k].argmax(1)==c[m]).sum()),baselineHits=int((Q[m,0].argmax(1)==c[m]).sum()))
(R/'bin-uncertainty.json').write_text(json.dumps(dict(scope='All predeclared candidates, retrospective descriptive intervals, no multiple-comparison correction',candidates=out),indent=2));print(json.dumps(out))
