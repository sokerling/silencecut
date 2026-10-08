import csv
import json
import struct
import subprocess
import time

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.video import find_binary, keep_intervals, probe_video


@pytest.fixture(scope="module")
def source(tmp_path_factory):
    path = tmp_path_factory.mktemp("editor-fixture") / "test source.mp4"
    # Colors and tones change at the same timestamps, exposing A/V drift after cuts.
    video = "color=c=red:s=160x90:r=25:d=6,drawbox=color=green:t=fill:enable='gte(t,2)*lt(t,4)',drawbox=color=blue:t=fill:enable='gte(t,4)'"
    audio = "aevalsrc=sin(2*PI*if(lt(t\\,2)\\,440\\,if(lt(t\\,4)\\,880\\,1320))*t):s=48000:d=6"
    subprocess.run(
        [find_binary("ffmpeg"), "-v", "error", "-y", "-f", "lavfi", "-i", video,
         "-f", "lavfi", "-i", audio, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(path)],
        check=True, capture_output=True,
    )
    return path


@pytest.fixture
def api(source, tmp_path):
    application = create_app(source_path=source, results_dir=tmp_path / "results", exports_dir=tmp_path / "exports")
    with TestClient(application) as client:
        yield client, tmp_path


def wait_for_export(client, job_id):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        job = client.get(f"/api/exports/{job_id}").json()
        if job["status"] in {"completed", "failed"}:
            assert job["status"] == "completed", job
            return job
        time.sleep(0.05)
    pytest.fail("Export timed out")


def test_metadata_and_real_byte_ranges(api, source):
    client, _ = api
    assert client.get("/api/health").json() == {"status": "ok"}
    metadata = client.get("/api/video").json()
    assert metadata["width"] == 160
    assert metadata["duration"] == pytest.approx(6, abs=0.05)
    data = source.read_bytes()
    full_head = client.head(metadata["url"])
    assert full_head.status_code == 200
    assert int(full_head.headers["content-length"]) == len(data)
    assert not full_head.content
    for header, start, end in [("bytes=12-87", 12, 87), ("bytes=-42", len(data)-42, len(data)-1), ("bytes=100-", 100, len(data)-1)]:
        response = client.get(metadata["url"], headers={"Range": header})
        assert response.status_code == 206
        assert response.content == data[start:end+1]
        assert response.headers["content-range"] == f"bytes {start}-{end}/{len(data)}"
    head = client.head(metadata["url"], headers={"Range": "bytes=2-5"})
    assert head.status_code == 206 and not head.content
    assert head.headers["content-length"] == "4"
    for header in [f"bytes={len(data)}-", "bytes=100-50", "bytes=-0", "bytes=0-1,4-5"]:
        response = client.get(metadata["url"], headers={"Range": header})
        assert response.status_code == 416
        assert response.headers["content-range"] == f"bytes */{len(data)}"


def test_save_roundtrip_and_validation(api):
    client, temporary = api
    intervals = [{"id": "b", "start": 2.1, "end": 3.9}, {"id": "a", "start": 0.5, "end": 1.2}]
    response = client.post("/api/cuts", json={"intervals": intervals})
    assert response.json() == {"filename": "ground_truth_intervals.csv", "count": 2}
    with (temporary / "results/ground_truth_intervals.csv").open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    assert [row["id"] for row in rows] == ["a", "b"]
    assert float(rows[0]["start"]) == 0.5
    assert float(rows[1]["duration"]) == pytest.approx(1.8)
    previous = (temporary / "results/ground_truth_intervals.csv").read_bytes()
    invalid = [
        [{"id": "a", "start": -1, "end": 2}],
        [{"id": "a", "start": 3, "end": 3}],
        [{"id": "a", "start": 1, "end": 7}],
        [{"id": "a", "start": 1, "end": 2}, {"id": "a", "start": 3, "end": 4}],
    ]
    for intervals in invalid:
        assert client.post("/api/cuts", json={"intervals": intervals}).status_code == 422
    for nonfinite in ["NaN", "Infinity", "-Infinity"]:
        payload = '{"intervals":[{"id":"a","start":' + nonfinite + ',"end":2}]}'
        assert client.post("/api/cuts", content=payload, headers={"content-type": "application/json"}).status_code == 422
    assert (temporary / "results/ground_truth_intervals.csv").read_bytes() == previous
    assert client.post("/api/cuts", json={"intervals": []}).json()["count"] == 0
    assert len((temporary / "results/ground_truth_intervals.csv").read_text().splitlines()) == 1


def test_overlap_union_does_not_change_user_intervals():
    cuts = [{"id": "b", "start": 3, "end": 5}, {"id": "a", "start": 1, "end": 4}, {"id": "c", "start": 5, "end": 6}]
    before = json.dumps(cuts)
    assert keep_intervals(cuts, 8) == [(0.0, 1.0), (6.0, 8)]
    assert json.dumps(cuts) == before
    assert keep_intervals([], 8) == [(0.0, 8)]
    assert keep_intervals([{"start": 0, "end": 8}], 8) == []


def decode_color(path, timestamp):
    process = subprocess.run(
        [find_binary("ffmpeg"), "-v", "error", "-ss", str(timestamp), "-i", str(path),
         "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
        check=True, capture_output=True,
    )
    return tuple(process.stdout[:3])


def decode_tone(path, timestamp):
    process = subprocess.run(
        [find_binary("ffmpeg"), "-v", "error", "-ss", str(timestamp), "-i", str(path),
         "-t", "0.12", "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"],
        check=True, capture_output=True,
    )
    samples = struct.unpack(f"<{len(process.stdout)//4}f", process.stdout)
    # Count positive zero crossings: ample precision for distinct 440/880/1320 Hz tones.
    crossings = sum(a <= 0 < b for a, b in zip(samples, samples[1:]))
    return crossings / (len(samples) / 48000)


def test_export_union_duration_and_audio_video_alignment(api):
    client, temporary = api
    cuts = [{"id": "a", "start": 1, "end": 2.2}, {"id": "b", "start": 1.7, "end": 3}, {"id": "c", "start": 4, "end": 4.5}]
    response = client.post("/api/export", json={"intervals": cuts})
    assert response.status_code == 202
    job = wait_for_export(client, response.json()["job_id"])
    assert job["progress"] == 100
    path = temporary / "exports" / job["filename"]
    metadata = probe_video(path)
    assert metadata["duration"] == pytest.approx(3.5, abs=0.05)
    for timestamp, channel, tone in [(0.5, 0, 440), (1.5, 1, 880), (2.5, 2, 1320)]:
        color = decode_color(path, timestamp)
        assert color[channel] > max(value for index, value in enumerate(color) if index != channel) + 30
        assert decode_tone(path, timestamp) == pytest.approx(tone, abs=30)
    streams = json.loads(subprocess.run([find_binary("ffprobe"), "-v", "error", "-show_streams", "-of", "json", str(path)], check=True, capture_output=True, text=True).stdout)["streams"]
    durations = [float(stream["duration"]) for stream in streams]
    assert max(durations) - min(durations) < 0.05
    download = client.get(job["download_url"])
    assert download.status_code == 200 and download.content == path.read_bytes()
    assert not (temporary / "results").exists()


def test_export_no_cuts_and_all_cut(api):
    client, temporary = api
    job_id = client.post("/api/export", json={"intervals": []}).json()["job_id"]
    job = wait_for_export(client, job_id)
    assert probe_video(temporary / "exports" / job["filename"])["duration"] == pytest.approx(6, abs=0.05)
    assert client.post("/api/export", json={"intervals": [{"id": "all", "start": 0, "end": 6}]}).status_code == 422
    assert client.get("/api/exports/missing").status_code == 404


def test_export_video_without_audio(source, tmp_path):
    silent = tmp_path / "silent.mp4"
    subprocess.run([find_binary("ffmpeg"), "-v", "error", "-y", "-i", str(source), "-an", "-c:v", "copy", str(silent)], check=True, capture_output=True)
    with TestClient(create_app(source_path=silent, results_dir=tmp_path / "results", exports_dir=tmp_path / "exports")) as client:
        response = client.post("/api/export", json={"intervals": [{"id": "c", "start": 2, "end": 4}]})
        job = wait_for_export(client, response.json()["job_id"])
        metadata = probe_video(tmp_path / "exports" / job["filename"])
        assert metadata["duration"] == pytest.approx(4, abs=0.05)
        assert not metadata["has_audio"]


def test_many_fractional_cuts_at_source_frame_rate(source, tmp_path):
    high_fps = tmp_path / "59.94 fps.mp4"
    subprocess.run(
        [find_binary("ffmpeg"), "-v", "error", "-y", "-i", str(source), "-r", "60000/1001",
         "-c:v", "libx264", "-c:a", "copy", str(high_fps)], check=True, capture_output=True,
    )
    duration = probe_video(high_fps)["duration"]
    cuts = [{"id": str(i), "start": 0.173+i*0.321, "end": 0.260+i*0.321} for i in range(17)]
    expected = duration - sum(cut["end"] - cut["start"] for cut in cuts)
    with TestClient(create_app(source_path=high_fps, results_dir=tmp_path / "results", exports_dir=tmp_path / "exports")) as client:
        job = wait_for_export(client, client.post("/api/export", json={"intervals": cuts}).json()["job_id"])
    path = tmp_path / "exports" / job["filename"]
    metadata = probe_video(path)
    assert metadata["duration"] == pytest.approx(expected, abs=0.035)
    assert metadata["fps"] == pytest.approx(60000/1001, rel=0.001)
    streams = json.loads(subprocess.run([find_binary("ffprobe"), "-v", "error", "-show_streams", "-of", "json", str(path)], check=True, capture_output=True, text=True).stdout)["streams"]
    assert all(abs(float(stream["start_time"])) < 0.001 for stream in streams)
    assert abs(float(streams[0]["duration"]) - float(streams[1]["duration"])) < 0.035
    # At the joins, picture color and corresponding audio tone must still agree.
    for timestamp in [0.4, 1.7, 3.4]:
        color = decode_color(path, timestamp)
        dominant = max(range(3), key=lambda index: color[index])
        assert decode_tone(path, timestamp) == pytest.approx([440, 880, 1320][dominant], abs=35)
