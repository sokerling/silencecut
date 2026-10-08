"""Video metadata, interval calculations, and a single FFmpeg export."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from fractions import Fraction
from pathlib import Path
from typing import Callable


def find_binary(name: str) -> str:
    configured = os.getenv(f"VIDEO_EDITOR_{name.upper()}")
    if configured:
        return configured
    located = shutil.which(name)
    if located:
        return located
    windows_path = Path("C:/Program Files/FFmpeg") / f"{name}.exe"
    if windows_path.is_file():
        return str(windows_path)
    raise RuntimeError(f"Не найден {name}. Установите FFmpeg и добавьте его в PATH.")


def probe_video(source: Path) -> dict:
    if not source.is_file():
        raise FileNotFoundError(f"Исходное видео не найдено: {source.name}")
    process = subprocess.run(
        [find_binary("ffprobe"), "-v", "error", "-show_format", "-show_streams", "-of", "json", str(source)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
    )
    if process.returncode:
        raise RuntimeError(process.stderr.strip() or "FFprobe не смог прочитать видео.")
    metadata = json.loads(process.stdout)
    video = next((stream for stream in metadata["streams"] if stream["codec_type"] == "video"), None)
    if video is None:
        raise RuntimeError("В файле нет видеодорожки.")
    frame_rate = video.get("avg_frame_rate") or video.get("r_frame_rate", "0/1")
    fps = float(Fraction(frame_rate)) if frame_rate != "0/0" else 0.0
    return {
        "filename": source.name,
        "duration": float(metadata["format"].get("duration") or video["duration"]),
        "width": int(video["width"]), "height": int(video["height"]), "fps": fps,
        "has_audio": any(stream["codec_type"] == "audio" for stream in metadata["streams"]),
        "url": "/api/video/stream",
    }


def keep_intervals(cuts: list[dict], duration: float) -> list[tuple[float, float]]:
    """Union CUT intervals, then take their complement without modifying the UI array."""
    merged: list[list[float]] = []
    for cut in sorted(cuts, key=lambda item: item["start"]):
        start, end = float(cut["start"]), float(cut["end"])
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    keep = []
    cursor = 0.0
    for start, end in merged:
        if start > cursor:
            keep.append((cursor, start))
        cursor = end
    if cursor < duration:
        keep.append((cursor, duration))
    return keep


def filter_graph(keep: list[tuple[float, float]], has_audio: bool) -> str:
    count = len(keep)
    lines = []
    if count > 1:
        lines.append(f"[0:v:0]split={count}" + "".join(f"[vi{i}]" for i in range(count)))
        if has_audio:
            lines.append(f"[0:a:0]asplit={count}" + "".join(f"[ai{i}]" for i in range(count)))
    for index, (start, end) in enumerate(keep):
        video_input = f"vi{index}" if count > 1 else "0:v:0"
        lines.append(f"[{video_input}]trim=start={start:.9f}:end={end:.9f},setpts=PTS-STARTPTS[v{index}]")
        if has_audio:
            audio_input = f"ai{index}" if count > 1 else "0:a:0"
            lines.append(f"[{audio_input}]atrim=start={start:.9f}:end={end:.9f},asetpts=PTS-STARTPTS[a{index}]")
    inputs = "".join(f"[v{i}]" + (f"[a{i}]" if has_audio else "") for i in range(count))
    lines.append(inputs + f"concat=n={count}:v=1:a={int(has_audio)}[vout]" + ("[aout]" if has_audio else ""))
    return ";\n".join(lines)


def export_video(
    source: Path,
    destination: Path,
    keep: list[tuple[float, float]],
    has_audio: bool,
    fps: float,
    update_progress: Callable[[float], None],
    register_process: Callable[[subprocess.Popen | None], None],
) -> None:
    """Encode kept intervals together so video and audio share every concat boundary."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(destination.stem + ".partial.mp4")
    expected_duration = sum(end - start for start, end in keep)
    try:
        # A graph file avoids the Windows command-line length limit for many CUTs.
        with tempfile.TemporaryDirectory(prefix="video-editor-") as temporary:
            graph_path = Path(temporary) / "filters.txt"
            graph_path.write_text(filter_graph(keep, has_audio), encoding="utf-8")
            command = [
                find_binary("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                "-i", str(source), "-filter_complex_threads", "1",
                "-/filter_complex", str(graph_path), "-map", "[vout]",
            ]
            if has_audio:
                command += ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"]
            command += [
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
                "-fps_mode", "cfr", "-r", str(fps or 25),
                "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", str(partial),
            ]
            with (Path(temporary) / "ffmpeg.log").open("w+", encoding="utf-8") as error_log:
                process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=error_log, text=True, encoding="utf-8", errors="replace")
                register_process(process)
                try:
                    assert process.stdout is not None
                    for line in process.stdout:
                        if line.startswith("out_time_us="):
                            try:
                                seconds = int(line.split("=", 1)[1]) / 1_000_000
                                update_progress(min(99.0, max(0.0, seconds / expected_duration * 100)))
                            except ValueError:
                                pass
                    return_code = process.wait()
                finally:
                    process.stdout.close()
                    register_process(None)
                if return_code:
                    error_log.seek(0)
                    raise RuntimeError(error_log.read()[-4000:].strip() or "FFmpeg завершился с ошибкой.")
        # FFmpeg can emit an audio-only MP4 if every KEEP is shorter than a video frame.
        probe_video(partial)
        partial.replace(destination)
    finally:
        partial.unlink(missing_ok=True)
