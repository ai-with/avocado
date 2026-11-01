#!/usr/bin/env python3
"""Local FFmpeg POC. No network, Cloud SDK, R2 credentials, or application DB.
Large input is streamed to a seekable private temporary file, never buffered.
The caller owns the only two output capabilities and the authoritative fence.
"""
import argparse, dataclasses, hashlib, json, math, os, selectors, shutil
import signal, subprocess, sys, tempfile, time, uuid, wave
from pathlib import Path

FFMPEG_VERSION = "8.1.1"
MIB = 1024**2

class MediaError(Exception):
    pass

@dataclasses.dataclass(frozen=True)
class Limits:
    input_bytes: int = 2 * 1024**3
    duration_s: float = 180
    chunk_bytes: int = MIB
    probe_seconds: float = 10
    process_seconds: float = 180
    job_seconds: float = 240
    process_output_bytes: int = 64 * 1024
    video_bytes: int = 64 * MIB
    audio_bytes: int = 6 * MIB

@dataclasses.dataclass(frozen=True)
class Job:
    declared_bytes: int
    generation: int
    consent_id: str
    source_etag: str

def fence(job, current):
    actual = current()
    if actual.get("withdrawn") or actual.get("consent_id") != job.consent_id:
        raise MediaError("withdrawn")
    if actual.get("generation") != job.generation or actual.get("source_etag") != job.source_etag:
        raise MediaError("generation_changed")

def bounded_run(argv, check, timeout, limit, directory, file_limit):
    """No shell or inherited credentials; bounded logs, process tree, time/files."""
    def child_limits():
        if sys.platform.startswith("linux"):
            import resource
            resource.setrlimit(resource.RLIMIT_FSIZE, (file_limit, file_limit))
            resource.setrlimit(resource.RLIMIT_AS, (768*MIB, 768*MIB))
    env = {"PATH": os.environ.get("PATH", ""), "LANG": "C", "LC_ALL": "C", "TMPDIR": str(directory)}
    if sys.platform.startswith("linux"):
        # Keep glibc's virtual arena reservations inside the existing AS cap.
        # Fixed control, never inherited from caller or user-overridable.
        env["MALLOC_ARENA_MAX"] = "2"
    started = time.monotonic()
    process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, cwd=directory, env=env, start_new_session=True, preexec_fn=child_limits)
    selector = selectors.DefaultSelector(); output = {"stdout": bytearray(), "stderr": bytearray()}
    for name in output:
        stream = getattr(process, name); os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ, name)
    try:
        while selector.get_map() or process.poll() is None:
            check()
            if time.monotonic()-started > timeout: raise MediaError("process_timeout")
            for key, _ in selector.select(.02):
                chunk = os.read(key.fileobj.fileno(), 8192)
                if not chunk: selector.unregister(key.fileobj); continue
                target = output[key.data]
                if len(target)+len(chunk) > limit: raise MediaError("process_output_limit")
                target.extend(chunk)
        if process.wait() != 0: raise MediaError("process_failed")
        return bytes(output["stdout"])
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL); process.wait()
        selector.close()
        process.stdout.close(); process.stderr.close()

def probe(path, check, limits, execute=bounded_run):
    args = ["ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe",
        "-format_whitelist", "mov,matroska,webm,wav", "-probesize", "8388608",
        "-analyzeduration", "5000000", "-max_probe_packets", "2500", "-threads", "1",
        "-show_entries", "format=format_name,duration,size,nb_streams:stream=index,codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels",
        "-of", "json", str(path)]
    try:
        data = json.loads(execute(args, check, limits.probe_seconds,
            limits.process_output_bytes, path.parent, limits.video_bytes))
        fmt, streams = data["format"], data["streams"]
        duration = float(fmt["duration"])
        if not math.isfinite(duration) or duration <= 0: raise ValueError()
        if not isinstance(streams, list) or type(fmt["nb_streams"]) is not int or int(fmt["size"]) != path.stat().st_size or fmt["nb_streams"] != len(streams) or not streams: raise ValueError()
        if any(not isinstance(s, dict) or type(s.get("index")) is not int for s in streams) or len({s["index"] for s in streams}) != len(streams) or any(not s.get("codec_name") for s in streams): raise ValueError()
        return duration, streams
    except MediaError:
        raise
    except (KeyError, TypeError, ValueError, OSError):
        raise MediaError("probe_incomplete") from None

def prepare(source, job, current, sink, *, limits=Limits(), temp_root=None, execute=bounded_run):
    """Sink stages audio.wav/video.mp4 and atomically commits with its own fence.
    retire_unselected MUST preserve an already selected result after a lost ACK.
    Original object ownership and deletion never cross this interface.
    """
    started = time.monotonic()
    def check():
        fence(job, current)
        if time.monotonic()-started > limits.job_seconds: raise MediaError("job_timeout")
    try:
        if type(job.declared_bytes) is not int or not 0 < job.declared_bytes <= limits.input_bytes:
            raise MediaError("input_size_limit")
        with tempfile.TemporaryDirectory(prefix="media-poc-", dir=temp_root) as temporary:
            directory = Path(temporary); original = directory/"input.bin"
            digest = hashlib.sha256(); total = 0
            with original.open("xb") as target:
                while True:
                    check(); chunk = source.read(min(limits.chunk_bytes, job.declared_bytes-total+1))
                    if not chunk: break
                    if not isinstance(chunk, bytes) or len(chunk) > limits.chunk_bytes: raise MediaError("input_stream_invalid")
                    total += len(chunk)
                    if total > job.declared_bytes or total > limits.input_bytes: raise MediaError("input_size_limit")
                    digest.update(chunk); target.write(chunk)
            if total != job.declared_bytes: raise MediaError("input_incomplete")
            duration, streams = probe(original, check, limits, execute)
            if duration > limits.duration_s: raise MediaError("duration_limit")
            video = [s for s in streams if s["codec_type"] == "video"]
            audio = [s for s in streams if s["codec_type"] == "audio"]
            if len(video) != 1 or len(audio) > 1 or len(streams) != 1+len(audio): raise MediaError("unsupported_stream_layout")
            v = video[0]
            try:
                rate = v["r_frame_rate"].split("/"); fps = int(rate[0])/int(rate[1])
                if not (0 < int(v["width"]) <= 4096 and 0 < int(v["height"]) <= 4096 and 0 < fps <= 60): raise ValueError()
            except (KeyError, ValueError, ZeroDivisionError): raise MediaError("video_limits") from None
            if audio and not (1 <= int(audio[0].get("channels", 0)) <= 8 and 0 < int(audio[0].get("sample_rate", 0)) <= 192000):
                raise MediaError("audio_limits")
            common = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-xerror",
                "-filter_threads", "1", "-filter_complex_threads", "1",
                "-err_detect", "explode", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm",
                "-max_pixels", "16777216", "-threads", "1", "-i", str(original), "-threads", "1", "-map_metadata", "-1", "-map_chapters", "-1"]
            artifacts = []; audio_state = {"state": "none", "proof": "complete_probe_and_video_decode_no_audio"}
            if audio:
                wav = directory/"audio.wav"
                execute(common+["-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-fs", str(limits.audio_bytes), "-y", str(wav)], check, limits.process_seconds, limits.process_output_bytes, directory, limits.audio_bytes)
                try:
                    with wave.open(str(wav)) as reader:
                        audio_duration = reader.getnframes()/reader.getframerate()
                        if (reader.getnchannels(), reader.getsampwidth(), reader.getframerate()) != (1, 2, 16000) or not 0 < audio_duration <= limits.duration_s+.1 or abs(audio_duration-duration) > .2: raise ValueError()
                except (OSError, EOFError, wave.Error, ValueError): raise MediaError("audio_incomplete") from None
                artifacts.append(("audio.wav", wav, limits.audio_bytes)); audio_state = {"state": "present", "sampleRate": 16000, "durationS": audio_duration}
            mp4 = directory/"video.mp4"
            scale = "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
            execute(common+["-map", "0:v:0", "-map", "0:a:0?", "-vf", scale,
                "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-maxrate", "2400k", "-bufsize", "4800k",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-fs", str(limits.video_bytes), "-y", str(mp4)], check, limits.process_seconds, limits.process_output_bytes, directory, limits.video_bytes)
            derived_duration, derived_streams = probe(mp4, check, limits, execute)
            derived_video = [s for s in derived_streams if s["codec_type"] == "video"]
            if abs(derived_duration-duration) > .2 or len(derived_streams) != len(streams) or len(derived_video) != 1 or derived_video[0]["codec_name"] != "h264" or not (0 < int(derived_video[0]["width"]) <= 1280 and 0 < int(derived_video[0]["height"]) <= 720):
                raise MediaError("video_incomplete")
            artifacts.append(("video.mp4", mp4, limits.video_bytes))
            manifest = {"v": 1, "generation": job.generation, "consentId": job.consent_id,
                "sourceEtag": job.source_etag, "inputBytes": total, "inputSha256": digest.hexdigest(),
                "durationS": duration, "audio": audio_state, "artifacts": [], "elapsedS": 0}
            for name, path, cap in artifacts:
                check(); size = path.stat().st_size
                if not 0 < size <= cap: raise MediaError("output_size_limit")
                def chunks(path=path):
                    with path.open("rb") as handle:
                        while chunk := handle.read(limits.chunk_bytes): check(); yield chunk
                with path.open("rb") as handle: checksum = hashlib.file_digest(handle, "sha256").hexdigest()
                metadata = {"name": name, "bytes": size, "sha256": checksum}
                sink.stage(name, chunks(), metadata); manifest["artifacts"].append(metadata)
            check(); manifest["elapsedS"] = round(time.monotonic()-started, 4)
            sink.commit(manifest, lambda: fence(job, current))
            return manifest
    except MediaError:
        sink.retire_unselected(); raise
    except Exception:
        sink.retire_unselected(); raise MediaError("preparation_failed") from None

class LocalSink:
    """Operator-selected LOCAL output only; never points at original or Cloud."""
    def __init__(self, root):
        self.stage_dir = Path(tempfile.mkdtemp(prefix=".staged-", dir=root)); self.final = Path(root)/str(uuid.uuid4()); self.selected = False
    def stage(self, name, chunks, metadata):
        if name not in {"audio.wav", "video.mp4"}: raise MediaError("output_not_allowed")
        with (self.stage_dir/name).open("xb") as target:
            for chunk in chunks: target.write(chunk)
    def commit(self, manifest, check):
        check(); (self.stage_dir/"manifest.json").write_text(json.dumps(manifest, indent=2)+"\n")
        self.stage_dir.rename(self.final); self.selected = True
    def retire_unselected(self):
        if not self.selected: shutil.rmtree(self.stage_dir, ignore_errors=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--input", required=True); parser.add_argument("--declared-bytes", type=int, required=True); parser.add_argument("--output-dir", required=True); args = parser.parse_args()
    os.umask(0o077); root = Path(args.output_dir); root.mkdir(parents=True, exist_ok=True)
    job = Job(args.declared_bytes, 1, "local-synthetic-consent", "local-original")
    state = dataclasses.asdict(job)|{"withdrawn": False}; sink = LocalSink(root)
    def interrupted(*_): raise MediaError("cancelled")
    signal.signal(signal.SIGTERM, interrupted); signal.signal(signal.SIGINT, interrupted)
    def expired(*_): raise MediaError("job_timeout")
    signal.signal(signal.SIGALRM, expired); signal.setitimer(signal.ITIMER_REAL, Limits().job_seconds)
    try:
        with (sys.stdin.buffer if args.input == "-" else open(args.input, "rb")) as source:
            print(json.dumps(prepare(source, job, lambda: state, sink)))
    except OSError:
        sink.retire_unselected(); raise MediaError("input_unavailable") from None
    except MediaError:
        sink.retire_unselected(); raise
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)

if __name__ == "__main__":
    try: main()
    except MediaError as error: print(json.dumps({"ok": False, "code": str(error)})); sys.exit(1)
