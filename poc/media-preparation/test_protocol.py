#!/usr/bin/env python3
"""Native local protocol checks, no sockets/Docker/Cloud/provider calls."""
import hashlib, io, json, os, signal, struct, subprocess, sys, tempfile, time, unittest
from pathlib import Path
from protocol import Wire, cleanup_stale
from runner import MediaError

def frame(value): return struct.pack('>I',len(value))+value
def take(source,cap):
    raw=source.read(4)
    if len(raw)!=4: raise AssertionError('missing frame')
    size=struct.unpack('>I',raw)[0]
    if size>cap: raise AssertionError('oversized frame')
    data=source.read(size)
    if len(data)!=size: raise AssertionError('truncated frame')
    return data

class ProtocolTest(unittest.TestCase):
    def setUp(self): self.temporary=tempfile.TemporaryDirectory(prefix='media-wire-test-');self.root=Path(self.temporary.name)
    def tearDown(self): self.temporary.cleanup()
    def movie(self):
        path=self.root/'source.mp4'
        subprocess.run(['ffmpeg','-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=10','-t','1','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-y',str(path)],check=True,capture_output=True,timeout=10)
        return path.read_bytes()
    def child(self,payload):
        return subprocess.run([sys.executable,'-B',str(Path(__file__).with_name('protocol.py'))],input=payload,capture_output=True,timeout=10,env={'PATH':os.environ.get('PATH',''),'TMPDIR':str(self.root),'LANG':'C'})
    def request(self,body):
        meta={'jobId':'12345678-1234-1234-1234-123456789abc','generation':1,'consentId':'local','sourceEtag':'immutable','declaredBytes':len(body)}
        return frame(json.dumps(meta).encode())+frame(body)+frame(b'')
    def test_real_native_roundtrip_footer_eof_and_hashes(self):
        body=self.movie(); result=self.child(self.request(body));self.assertEqual(result.returncode,0)
        source=io.BytesIO(result.stdout);manifest=json.loads(take(source,16384));self.assertEqual(manifest['inputSha256'],hashlib.sha256(body).hexdigest());self.assertEqual(manifest['audio']['state'],'none')
        for item in manifest['artifacts']:
            digest=hashlib.sha256();total=0
            while chunk:=take(source,1024**2):total+=len(chunk);digest.update(chunk)
            self.assertEqual(total,item['bytes']);self.assertEqual(digest.hexdigest(),item['sha256'])
        self.assertEqual(take(source,0),b'');self.assertEqual(source.read(),b'')
        self.assertEqual(list((self.root/'media-private-jobs').iterdir()),[])
    def test_missing_terminator_and_trailing_input_are_rejected(self):
        payload=self.request(self.movie())
        for bad in (payload[:-4],payload+b'garbage'):
            result=self.child(bad);self.assertNotEqual(result.returncode,0);self.assertEqual(result.stdout,b'');self.assertEqual(list((self.root/'media-private-jobs').iterdir()),[])
    def test_io_idle_disarms_for_longer_compute_with_total_budget_retained(self):
        old=signal.getsignal(signal.SIGALRM)
        def expired(*_):raise MediaError('unexpected_idle')
        signal.signal(signal.SIGALRM,expired)
        try:
            wire=Wire(io.BytesIO(frame(b'x')),io.BytesIO(),idle=.01,total=.5)
            self.assertEqual(wire.frame(10),b'x');time.sleep(.04)
            wire.write(b'x');time.sleep(.04)
            remaining,_=signal.getitimer(signal.ITIMER_REAL);self.assertGreater(remaining,.2)
        finally:signal.setitimer(signal.ITIMER_REAL,0);signal.signal(signal.SIGALRM,old)
    def test_sigkill_residue_recovery_only_owns_its_prefix_and_never_follows_links(self):
        root=self.root/'jobs';root.mkdir();old=root/'media-poc-orphan';old.mkdir();(old/'input.bin').write_bytes(b'LOCAL SYNTHETIC')
        outside=self.root/'outside';outside.mkdir();(outside/'keep').write_bytes(b'KEEP')
        (root/'media-poc-link').symlink_to(outside,target_is_directory=True);(root/'unrelated').mkdir()
        cleanup_stale(root)
        self.assertTrue((outside/'keep').exists());self.assertEqual([p.name for p in root.iterdir()],['unrelated'])

if __name__=='__main__':unittest.main(verbosity=2)
