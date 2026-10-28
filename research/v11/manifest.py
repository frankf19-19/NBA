import json,hashlib,numpy as np
from pathlib import Path
files=['research/v7/clean-reference.npz','research/v7/clean-meta.json','research/v11/source.json','research/v11/features.npz','research/v11/predictions.npy']
z=np.load(files[0]);out=dict(cutoff='2026-07-01',lastHistoricalGame=str(max(z['dates'])),records=len(z['y']),research='retrospective only; frozen current-family reference',numpy=np.__version__,files=[dict(path=p,bytes=Path(p).stat().st_size,sha256=hashlib.sha256(Path(p).read_bytes()).hexdigest()) for p in files]);Path('research/v11/manifest.json').write_text(json.dumps(out,indent=2));print(json.dumps({k:v for k,v in out.items() if k!='files'}))
