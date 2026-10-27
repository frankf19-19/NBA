import importlib.util,datetime
from pathlib import Path
s=importlib.util.spec_from_file_location('travel',Path(__file__).with_name('features.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
assert m.km('LosAngeles','LosAngeles')==0
assert 3500<m.km('LosAngeles','NewYork')<4500
summer=datetime.datetime(2026,7,1,tzinfo=datetime.timezone.utc);winter=datetime.datetime(2026,1,1,tzinfo=datetime.timezone.utc)
assert m.offset('Phoenix',summer)==m.offset('Phoenix',winter)==-7
assert m.offset('NewYork',summer)==-4 and m.offset('NewYork',winter)==-5
assert m.home_ok({'hid':28,'hm':'Toronto Raptors','sy':2021},'Tampa')
assert not m.home_ok({'hid':28,'hm':'Toronto Raptors','sy':2026},'Tampa')
assert m.site({'ven':'Arena CDMX'}) is None
print('Travel geography checks passed: metro approximations, historic Tampa exception, unknown venue fallback, Phoenix and DST offsets.')
