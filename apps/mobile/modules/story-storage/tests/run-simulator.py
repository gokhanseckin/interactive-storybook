"""Run only against a dedicated simulator UUID supplied by the caller.
Requires build-harness.sh output installed and origin.py on 127.0.0.1:46371.
Saves per-scenario logs and origin counters; this is native simulator evidence,
not Expo UI, physical-device or Android acceptance.
"""
import argparse, subprocess, pathlib, time, json, urllib.request
p=argparse.ArgumentParser();p.add_argument('--udid',required=True);p.add_argument('--output',required=True);p.add_argument('--modes');args=p.parse_args()
app='test.story.delivery.reliability'
def sim(*a, check=True): return subprocess.run(['xcrun','simctl',*a],capture_output=True,text=True,check=check).stdout.strip()
def root(): return pathlib.Path(sim('get_app_container',args.udid,app,'data'))/'Library/Application Support/StoryMedia'
def stats(): return json.load(urllib.request.urlopen('http://127.0.0.1:46371/stats'))
results=[]
def run(mode, after_start=None):
    before_origin=stats()
    sim('terminate',args.udid,app,check=False)
    log=root()/'harness.log';before=len(log.read_text()) if log.exists() else 0
    sim('launch',args.udid,app,mode)
    if after_start: after_start()
    for _ in range(600):
        text=log.read_text()[before:] if log.exists() else ''
        if 'FAIL ' in text: raise RuntimeError(mode+': '+text)
        if ('PASS '+mode+' ') in text or (mode=='recover' and 'PASS offline complete recovery' in text) or (mode=='corrupt' and 'PASS checksum failure' in text) or (mode=='bad-range' and 'PASS malformed range' in text):
            origin=stats()
            if mode.startswith('recover'): assert origin==before_origin, 'Offline recovery contacted media origin'
            if mode.startswith('background'):
                journal=json.loads((root()/'transfers.json').read_text())
                assert 'NATIVE didEnterBackground' in text
                assert any(j.get('state')=='complete' and j.get('foreground') is False for j in journal.values())
                assert len(origin['requests'])==2 and origin['requests'][1]['range'] is not None
            result={'mode':mode,'log':text,'origin':origin};results.append(result)
            pathlib.Path(args.output).write_text(json.dumps(results,indent=2))
            print(json.dumps(result),flush=True);return
        time.sleep(.25)
    raise RuntimeError('Timed out '+mode+': '+text)
if args.modes:
    for mode in args.modes.split(','):
        def transition():
            time.sleep(.5);sim('launch',args.udid,'com.apple.Preferences')
        run(mode, transition if mode.startswith('background') else None)
    print('PASS selected simulator checks',flush=True)
    raise SystemExit(0)
for mode in ['clean','pause','policy','ignore-range','bad-range','corrupt','interrupt','recover']:
    run(mode)
# Complete-prefix recovery: reproduce the last-write/pre-promotion process-death window.
sim('terminate',args.udid,app,check=False)
media=next(root().glob('*.mp3'));partial=media.with_suffix('.partial');media.rename(partial)
run('recover')
# Complete corrupt and missing files must never be marked offline-usable.
media=next(root().glob('*.mp3'));data=media.read_bytes();media.write_bytes(bytes([data[0]^255])+data[1:])
run('recover-corrupt');media.unlink();run('recover-missing')
# Actual process termination with an incomplete sequential prefix, then a new process.
sim('terminate',args.udid,app,check=False);sim('launch',args.udid,app,'background')
for _ in range(100):
    partials=list(root().glob('*.partial'))
    if partials and partials[0].stat().st_size>=65536: break
    time.sleep(.05)
sim('terminate',args.udid,app)
run('resume')
# A confirmed UIKit callback, background task journal and a suffix origin request are
# needed before this is evidence of background handoff.
def background():
    time.sleep(.5);sim('launch',args.udid,'com.apple.Preferences')
run('background',background)
assert 'NATIVE didEnterBackground' in results[-1]['log']
assert len(results[-1]['origin']['requests'])==2
run('slow')
run('background-slow',background)
print('PASS simulator matrix',flush=True)
