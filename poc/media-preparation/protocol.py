#!/usr/bin/env python3
"""Bounded exec stdin/stdout protocol; no HTTP server, network, credentials or DB.
Wire: u32be JSON-header length + JSON; u32be input chunks ending with zero.
Reply: bounded manifest frame; each artifact's byte frames + zero; final zero EOF.
"""
import contextlib, hashlib, json, os, shutil, signal, struct, sys, tempfile, time
from pathlib import Path
from runner import Job, Limits, MediaError, prepare

CHUNK = 1024**2

def unique(pairs):
    value = {}
    for key,item in pairs:
        if key in value: raise MediaError("protocol_duplicate_key")
        value[key] = item
    return value

class Wire:
    def __init__(self, source, target, *, idle=15, total=240):
        self.source=source; self.target=target; self.idle=idle; self.deadline=time.monotonic()+total
    def arm(self,idle=False):
        remaining=self.deadline-time.monotonic()
        if remaining<=0: raise MediaError("job_timeout")
        signal.setitimer(signal.ITIMER_REAL,min(self.idle,remaining) if idle else remaining)
    @contextlib.contextmanager
    def io(self):
        self.arm(idle=True)
        try: yield
        except BaseException:
            signal.setitimer(signal.ITIMER_REAL,0); raise
        else: self.arm()  # Compute is bounded by total budget, never I/O idle.
    def exact(self,size):
        result=bytearray()
        while len(result)<size:
            with self.io(): piece=getattr(self.source,'read1',self.source.read)(size-len(result))
            if not piece: raise MediaError("protocol_input_incomplete")
            result.extend(piece)
        return bytes(result)
    def frame(self,cap):
        size=struct.unpack('>I',self.exact(4))[0]
        if size>cap: raise MediaError("protocol_frame_limit")
        return self.exact(size) if size else b''
    def write(self,data):
        if len(data)>CHUNK: raise MediaError("protocol_frame_limit")
        with self.io():
            self.target.write(struct.pack('>I',len(data))); self.target.write(data); self.target.flush()
    def eof(self):
        with self.io(): extra=getattr(self.source,'read1',self.source.read)(1)
        if extra: raise MediaError('protocol_input_trailing')

class Input:
    def __init__(self,wire,size): self.wire=wire; self.size=size; self.total=0; self.pending=b''; self.done=False
    def read(self,size):
        if not 0<size<=CHUNK: raise MediaError("protocol_read_limit")
        if not self.pending and not self.done:
            piece=self.wire.frame(CHUNK)
            if not piece:
                self.done=True
                if self.total!=self.size: raise MediaError("input_incomplete")
                self.wire.eof()
            else:
                self.total+=len(piece)
                if self.total>self.size: raise MediaError("input_size_limit")
                self.pending=piece
        result,self.pending=self.pending[:size],self.pending[size:]
        return result

class Sink:
    def __init__(self,wire): self.wire=wire; self.outputs=[]
    def stage(self,name,chunks,metadata):
        if name not in {'audio.wav','video.mp4'}: raise MediaError('output_not_allowed')
        self.outputs.append((name,chunks,metadata))
    def commit(self,manifest,check):
        check(); data=json.dumps(manifest,separators=(',',':')).encode()
        if len(data)>16384: raise MediaError('manifest_limit')
        self.wire.write(data)
        for _,chunks,metadata in self.outputs:
            total=0; checksum=hashlib.sha256()
            for chunk in chunks:
                check(); total+=len(chunk); checksum.update(chunk); self.wire.write(chunk)
            if total!=metadata['bytes'] or checksum.hexdigest()!=metadata['sha256']: raise MediaError('output_incomplete')
            self.wire.write(b'')
        self.wire.write(b'')
    def retire_unselected(self): pass  # Caller owns staged R2; temp dirs are local.

def cleanup_stale(root):
    """Only our private prefix, before a single new job; never follow symlinks."""
    root.mkdir(mode=0o700,parents=True,exist_ok=True)
    for item in root.iterdir():
        if item.name.startswith('media-poc-'):
            if item.is_symlink(): item.unlink()
            elif item.is_dir(): shutil.rmtree(item)

def run():
    os.umask(0o077)
    def cancelled(*_): raise MediaError('cancelled')
    def expired(*_): raise MediaError('protocol_idle_or_deadline')
    signal.signal(signal.SIGTERM,cancelled); signal.signal(signal.SIGINT,cancelled); signal.signal(signal.SIGALRM,expired)
    root=Path(tempfile.gettempdir())/'media-private-jobs'; cleanup_stale(root)
    wire=Wire(sys.stdin.buffer,sys.stdout.buffer)
    try:
        header=json.loads(wire.frame(4096),object_pairs_hook=unique)
        if set(header)!={'jobId','generation','consentId','sourceEtag','declaredBytes'} or type(header['declaredBytes']) is not int or not 0<header['declaredBytes']<=Limits().input_bytes: raise MediaError('job_invalid')
        job=Job(header['declaredBytes'],header['generation'],header['consentId'],header['sourceEtag'])
        current={'generation':job.generation,'consent_id':job.consent_id,'source_etag':job.source_etag,'withdrawn':False}
        # Supervisor polls the real app permit; image receives no DB/secret.
        prepare(Input(wire,job.declared_bytes),job,lambda:current,Sink(wire),temp_root=root)
    finally:
        signal.setitimer(signal.ITIMER_REAL,0)

if __name__=='__main__':
    try: run()
    except BaseException:
        # Fixed error only; never print filenames, input metadata or FFmpeg stderr.
        sys.stderr.write('media_protocol_failed\n'); sys.exit(1)
