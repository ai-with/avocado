#!/usr/bin/env python3
"""Cost-free native FFmpeg + fake publication tests. No HTTP/Cloud/AI/browser."""
import argparse, dataclasses, hashlib, io, json, os, platform, shutil, struct
import subprocess, sys, tempfile, time, unittest
from pathlib import Path
from runner import Job, Limits, MediaError, bounded_run, prepare

EVIDENCE = []

class Sink:
    def __init__(self, state, mode="normal"):
        self.state = state; self.mode = mode; self.staged = {}; self.selected = None
    def stage(self, name, chunks, metadata):
        assert name in {"audio.wav", "video.mp4"}
        data = b"".join(chunks)
        assert len(data) == metadata["bytes"] and hashlib.sha256(data).hexdigest() == metadata["sha256"]
        self.staged[name] = data
        if self.mode == "withdraw": self.state["withdrawn"] = True
        if self.mode == "generation": self.state["generation"] += 1
    def commit(self, manifest, check):
        check(); self.selected = manifest
        if self.mode == "lost_ack": raise MediaError("publish_unknown")
    def retire_unselected(self):
        if self.selected is None: self.staged.clear()

class BoundedInput(io.BufferedReader):
    largest_read = 0
    def read(self, size=-1):
        assert 0 < size <= 1024**2
        self.largest_read = max(self.largest_read, size)
        return super().read(size)

class MediaPoc(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = tempfile.TemporaryDirectory(prefix="media-poc-fixtures-")
        cls.directory = Path(cls.root.name); cls.samples = {}
        for kind in ("tone", "silence", "no_audio"):
            path = cls.directory/(kind+".mp4")
            argv = ["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10"]
            if kind != "no_audio":
                argv += ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000" if kind == "tone" else "anullsrc=r=16000:cl=mono"]
            argv += ["-t", "1", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "1", "-pix_fmt", "yuv420p"]
            if kind != "no_audio": argv += ["-c:a", "aac"]
            subprocess.run(argv+["-movflags", "+faststart", "-y", str(path)], check=True, capture_output=True, timeout=15)
            cls.samples[kind] = path
    @classmethod
    def tearDownClass(cls): cls.root.cleanup()
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="media-poc-test-")
        self.temp = Path(self.temporary.name); self.state = {"generation": 1, "consent_id": "synthetic", "source_etag": "original", "withdrawn": False}
    def tearDown(self): self.temporary.cleanup()
    def run_sample(self, kind="tone", mode="normal", *, path=None, execute=bounded_run):
        path = path or self.samples[kind]; sink = Sink(self.state, mode)
        with path.open("rb") as handle: before = hashlib.file_digest(handle, "sha256").hexdigest()
        with BoundedInput(path.open("rb")) as source:
            result = prepare(source, Job(path.stat().st_size, 1, "synthetic", "original"), lambda: self.state, sink, temp_root=self.temp, execute=execute)
            self.assertLessEqual(source.largest_read, 1024**2)
        with path.open("rb") as handle: self.assertEqual(hashlib.file_digest(handle, "sha256").hexdigest(), before)
        self.assertEqual(result["inputSha256"], before); self.assertEqual(list(self.temp.iterdir()), [])
        EVIDENCE.append({"fixture": kind, "inputBytes": path.stat().st_size, "elapsedS": result["elapsedS"], "audioState": result["audio"]["state"], "artifacts": result["artifacts"]})
        return result, sink
    def test_tone_silent_track_and_no_audio_remain_distinct(self):
        for kind in ("tone", "silence", "no_audio"):
            with self.subTest(kind=kind):
                result, sink = self.run_sample(kind)
                self.assertEqual(result["audio"]["state"], "none" if kind == "no_audio" else "present")
                self.assertEqual(set(sink.staged), {"video.mp4"} if kind == "no_audio" else {"audio.wav", "video.mp4"})
    def test_600_mib_sparse_padding_is_streamed_not_a_real_entropy_benchmark(self):
        padded = self.temp/"padded.mp4"; shutil.copyfile(self.samples["tone"], padded)
        target = 600*1024**2; padding = target-padded.stat().st_size
        with padded.open("r+b") as handle:
            handle.seek(0,os.SEEK_END); handle.write(struct.pack(">I4s", padding, b"free")); handle.truncate(target)
        isolated = self.directory/"padded-600mib.mp4"; padded.rename(isolated)
        try:
            result, _ = self.run_sample("sparse_padding_600MiB_not_high_entropy", path=isolated)
            self.assertGreater(result["inputBytes"], 500*1024**2)
        finally: isolated.unlink()
    def test_2_gib_and_actual_byte_caps(self):
        sink = Sink(self.state)
        with self.assertRaisesRegex(MediaError, "input_size_limit"):
            prepare(io.BytesIO(b"x"), Job(2*1024**3+1, 1, "synthetic", "original"), lambda: self.state, sink, temp_root=self.temp)
        for declared, content, code in [(3, b"xxxx", "input_size_limit"), (4, b"xxx", "input_incomplete")]:
            with self.assertRaisesRegex(MediaError, code):
                prepare(io.BytesIO(content), Job(declared, 1, "synthetic", "original"), lambda: self.state, sink, limits=Limits(input_bytes=4), temp_root=self.temp)
        self.assertEqual(list(self.temp.iterdir()), []); self.assertIsNone(sink.selected)
    def test_failed_and_incomplete_probe_are_never_no_audio(self):
        for content in (b"truncated mp4", b""):
            with self.assertRaises(MediaError):
                prepare(io.BytesIO(content), Job(max(1, len(content)), 1, "synthetic", "original"), lambda: self.state, Sink(self.state), temp_root=self.temp)
        def partial(*_): return b'{"streams":[]}'
        with self.assertRaisesRegex(MediaError, "probe_incomplete"):
            self.run_sample(execute=partial)
        self.assertEqual(list(self.temp.iterdir()), [])
    def test_probe_duration_over_180_is_rejected_before_encode(self):
        def too_long(argv, *_):
            return json.dumps({"format":{"duration":"180.01","size":str(self.samples['tone'].stat().st_size),"nb_streams":1},"streams":[{"index":0,"codec_type":"video","codec_name":"h264"}]}).encode()
        with self.assertRaisesRegex(MediaError, "duration_limit"): self.run_sample(execute=too_long)
        self.assertEqual(list(self.temp.iterdir()), [])
    def test_truncated_compressed_output_is_not_published(self):
        sink = Sink(self.state)
        with self.samples['tone'].open('rb') as source, self.assertRaises(MediaError):
            prepare(source,Job(self.samples['tone'].stat().st_size,1,'synthetic','original'),lambda:self.state,sink,limits=Limits(video_bytes=1024),temp_root=self.temp)
        self.assertIsNone(sink.selected); self.assertEqual(sink.staged,{}); self.assertEqual(list(self.temp.iterdir()),[])
    def test_withdraw_and_generation_change_never_publish_and_clear_temp(self):
        for mode in ("withdraw", "generation"):
            self.state.update(generation=1, withdrawn=False); sink = Sink(self.state, mode)
            with self.samples["tone"].open("rb") as source, self.assertRaisesRegex(MediaError, "withdrawn|generation_changed"):
                prepare(source, Job(self.samples["tone"].stat().st_size, 1, "synthetic", "original"), lambda: self.state, sink, temp_root=self.temp)
            self.assertIsNone(sink.selected); self.assertEqual(sink.staged, {}); self.assertEqual(list(self.temp.iterdir()), [])
    def test_lost_publish_ack_does_not_delete_selected_output(self):
        sink = Sink(self.state, "lost_ack")
        with self.samples["tone"].open("rb") as source, self.assertRaisesRegex(MediaError, "publish_unknown"):
            prepare(source, Job(self.samples["tone"].stat().st_size, 1, "synthetic", "original"), lambda: self.state, sink, temp_root=self.temp)
        self.assertIsNotNone(sink.selected); self.assertEqual(set(sink.staged), {"audio.wav", "video.mp4"}); self.assertEqual(list(self.temp.iterdir()), [])
    def test_process_timeout_output_cap_cancellation_and_clean_env(self):
        for argv, code, timeout, cap in [([sys.executable,"-c","import time;time.sleep(5)"],"process_timeout",.05,100),([sys.executable,"-c","print('x'*10000)"],"process_output_limit",2,100)]:
            with self.assertRaisesRegex(MediaError, code): bounded_run(argv, lambda: None, timeout, cap, self.temp, 1024)
        def cancel(): raise MediaError("withdrawn")
        with self.assertRaisesRegex(MediaError, "withdrawn"): bounded_run([sys.executable,"-c","import time;time.sleep(5)"], cancel, 2, 100, self.temp, 1024)
        names = bounded_run([sys.executable,"-c","import os,json;print(json.dumps(sorted(os.environ)))"],lambda:None,2,1024,self.temp,1024)
        self.assertNotIn("TOKEN_ENC_KEY", json.loads(names)); self.assertNotIn("CLOUDFLARE_API_TOKEN", json.loads(names))
    def test_cli_signals_clean_blocked_input_and_staged_outputs(self):
        import signal
        for number,code in ((signal.SIGTERM,'cancelled'),(signal.SIGALRM,'job_timeout')):
            with self.subTest(signal=number):
                work = self.temp/f"work-{number}"; output = self.temp/f"output-{number}"; work.mkdir()
                child = subprocess.Popen([sys.executable, str(Path(__file__).with_name("runner.py")), "--input", "-", "--declared-bytes", "100", "--output-dir", str(output)],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    env={"PATH":os.environ.get("PATH",""),"TMPDIR":str(work),"LANG":"C"})
                try:
                    until=time.monotonic()+3
                    while not list(work.iterdir()) and time.monotonic()<until: time.sleep(.01)
                    self.assertTrue(list(work.iterdir())); child.send_signal(number); stdout,_=child.communicate(timeout=3)
                    self.assertEqual(json.loads(stdout)["code"],code); self.assertEqual(list(work.iterdir()),[]); self.assertEqual(list(output.iterdir()),[])
                finally:
                    if child.poll() is None: child.kill(); child.wait()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("--report"); args = parser.parse_args()
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(MediaPoc))
    if args.report:
        version = subprocess.run(["ffmpeg","-version"],capture_output=True,text=True,check=True).stdout.splitlines()[0]
        Path(args.report).write_text(json.dumps({"base":"71d7b42","localOnly":True,"cloudMeasured":False,"cloudCalls":0,"aiCalls":0,"browserCalls":0,"python":platform.python_version(),"host":platform.machine(),"ffmpeg":version,"tests":result.testsRun,"passed":result.wasSuccessful(),"measurements":EVIDENCE,"largeFixtureWarning":"600MiB sparse MP4 free-box padding, not a real high-entropy video processing benchmark"},indent=2)+"\n")
    sys.exit(0 if result.wasSuccessful() else 1)
