from __future__ import annotations

import csv
import os
import re
import subprocess
import tempfile
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .video import export_video, find_binary, keep_intervals, probe_video


class CutInterval(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=200)
    start: float = Field(ge=0)
    end: float = Field(gt=0)

    @model_validator(mode="after")
    def validate_boundaries(self):
        if self.end <= self.start:
            raise ValueError("end должен быть больше start")
        return self


class CutsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    intervals: list[CutInterval] = Field(max_length=2000)

    @model_validator(mode="after")
    def validate_unique_ids(self):
        identifiers = [interval.id for interval in self.intervals]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("id интервалов должны быть уникальными")
        return self


def parse_byte_range(header: str, size: int) -> tuple[int, int]:
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", header.strip())
    if not match or size <= 0:
        raise ValueError("Invalid byte range")
    first, last = match.groups()
    if not first:
        if not last or int(last) <= 0:
            raise ValueError("Invalid suffix range")
        return max(0, size - int(last)), size - 1
    start = int(first)
    end = min(int(last), size - 1) if last else size - 1
    if start >= size or end < start:
        raise ValueError("Unsatisfiable byte range")
    return start, end


def read_range(source: Path, start: int, length: int):
    with source.open("rb") as stream:
        stream.seek(start)
        remaining = length
        while remaining:
            chunk = stream.read(min(256 * 1024, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def create_app(
    source_path: str | Path | None = None,
    results_dir: str | Path | None = None,
    exports_dir: str | Path | None = None,
) -> FastAPI:
    backend = Path(__file__).resolve().parents[1]
    source = Path(source_path or os.getenv("VIDEOEDITOR_VIDEO_PATH") or os.getenv("VIDEO_EDITOR_SOURCE", backend / "test_video.mp4")).resolve()
    results = Path(results_dir or os.getenv("VIDEOEDITOR_RESULTS_DIR") or os.getenv("VIDEO_EDITOR_RESULTS_DIR", backend / "results")).resolve()
    exports = Path(exports_dir or os.getenv("VIDEOEDITOR_EXPORTS_DIR") or os.getenv("VIDEO_EDITOR_EXPORTS_DIR", backend / "exports")).resolve()
    jobs: dict[str, dict] = {}
    processes: dict[str, subprocess.Popen] = {}
    lock = threading.Lock()
    stopping = threading.Event()
    metadata_cache: tuple[int, int, dict] | None = None

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        stopping.clear()
        application.state.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="video-export")
        yield
        stopping.set()
        with lock:
            for process in processes.values():
                if process.poll() is None:
                    process.terminate()
        application.state.executor.shutdown(wait=True, cancel_futures=True)

    app = FastAPI(title="SilenceCut API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["GET", "HEAD", "POST"], allow_headers=["Content-Type", "Range"],
        expose_headers=["Content-Length", "Content-Range", "Accept-Ranges"],
    )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError):
        # Keep invalid NaN/Infinity values out of the JSON error response itself.
        details = [{"loc": item["loc"], "msg": item["msg"], "type": item["type"]} for item in error.errors()]
        return JSONResponse(status_code=422, content={"detail": details})

    def video_info() -> dict:
        nonlocal metadata_cache
        try:
            stat = source.stat()
            signature = (stat.st_mtime_ns, stat.st_size)
            if metadata_cache is None or metadata_cache[:2] != signature:
                metadata_cache = (*signature, probe_video(source))
            return metadata_cache[2]
        except FileNotFoundError as error:
            raise HTTPException(404, "test_video.mp4 не найден") from error
        except (RuntimeError, subprocess.SubprocessError, ValueError, KeyError) as error:
            raise HTTPException(503, f"Не удалось прочитать видео: {error}") from error

    def validated_cuts(payload: CutsRequest) -> list[dict]:
        duration = video_info()["duration"]
        if any(interval.end > duration for interval in payload.intervals):
            raise HTTPException(422, "CUT-интервалы должны находиться внутри видео")
        return [interval.model_dump() for interval in payload.intervals]

    def update_job(job_id: str, **fields):
        with lock:
            jobs[job_id].update(fields)

    def run_export(job_id: str, keep: list[tuple[float, float]], has_audio: bool, fps: float, destination: Path):
        if stopping.is_set():
            return
        update_job(job_id, status="running")

        def register(process: subprocess.Popen | None):
            with lock:
                if process is None:
                    processes.pop(job_id, None)
                else:
                    processes[job_id] = process
                    if stopping.is_set():
                        process.terminate()

        try:
            export_video(source, destination, keep, has_audio, fps, lambda value: update_job(job_id, progress=value), register)
            update_job(job_id, status="completed", progress=100.0, download_url=f"/api/exports/{job_id}/download")
        except Exception as error:
            update_job(job_id, status="failed", error=str(error))

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/video")
    def video():
        info = video_info()
        return {key: value for key, value in info.items() if key != "has_audio"}

    @app.api_route("/api/video/stream", methods=["GET", "HEAD"])
    def stream_video(request: Request):
        if not source.is_file():
            raise HTTPException(404, "test_video.mp4 не найден")
        size = source.stat().st_size
        headers = {"Accept-Ranges": "bytes", "Content-Type": "video/mp4"}
        start, end, status = 0, size - 1, 200
        if "range" in request.headers:
            try:
                start, end = parse_byte_range(request.headers["range"], size)
            except ValueError:
                return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"})
            status = 206
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        length = end - start + 1
        headers["Content-Length"] = str(length)
        if request.method == "HEAD":
            return Response(status_code=status, headers=headers)
        return StreamingResponse(read_range(source, start, length), status_code=status, headers=headers)

    @app.post("/api/cuts")
    def save_cuts(payload: CutsRequest):
        intervals = validated_cuts(payload)
        results.mkdir(parents=True, exist_ok=True)
        destination = results / "ground_truth_intervals.csv"
        # Atomic replacement prevents a half-written annotation file.
        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="", dir=results, suffix=".tmp", delete=False) as stream:
                temporary_path = Path(stream.name)
                writer = csv.DictWriter(stream, fieldnames=["id", "start", "end", "duration"])
                writer.writeheader()
                for interval in sorted(intervals, key=lambda item: (item["start"], item["end"])):
                    writer.writerow({**interval, "duration": interval["end"] - interval["start"]})
            temporary_path.replace(destination)
        finally:
            if temporary_path:
                temporary_path.unlink(missing_ok=True)
        return {"filename": destination.name, "count": len(intervals)}

    @app.post("/api/export", status_code=202)
    def start_export(payload: CutsRequest):
        intervals = validated_cuts(payload)
        info = video_info()
        keep = keep_intervals(intervals, info["duration"])
        if not keep:
            raise HTTPException(422, "CUT-интервалы удаляют всё видео. Оставьте хотя бы один участок.")
        try:
            find_binary("ffmpeg")
        except RuntimeError as error:
            raise HTTPException(503, str(error)) from error
        job_id = uuid.uuid4().hex
        filename = f"edited_{job_id[:12]}.mp4"
        with lock:
            jobs[job_id] = {
                "job_id": job_id, "status": "queued", "progress": 0.0,
                "error": None, "filename": filename, "download_url": None,
            }
        app.state.executor.submit(run_export, job_id, keep, info["has_audio"], info["fps"], exports / filename)
        return {"job_id": job_id, "status": "queued"}

    @app.get("/api/exports/{job_id}")
    def export_status(job_id: str):
        with lock:
            if job_id not in jobs:
                raise HTTPException(404, "Экспорт не найден")
            return jobs[job_id].copy()

    @app.get("/api/exports/{job_id}/download")
    def download_export(job_id: str):
        job = export_status(job_id)
        if job["status"] != "completed":
            raise HTTPException(409, "Экспорт ещё не завершён")
        destination = exports / job["filename"]
        if not destination.is_file():
            raise HTTPException(404, "Файл экспорта не найден")
        return FileResponse(destination, media_type="video/mp4", filename=destination.name)

    return app


app = create_app()
