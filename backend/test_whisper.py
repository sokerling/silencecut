from faster_whisper import WhisperModel
import time
import os
import nvidia.cublas
import nvidia.cudnn

os.add_dll_directory(os.path.join(nvidia.cublas.__path__[0], "bin"))
os.add_dll_directory(os.path.join(nvidia.cudnn.__path__[0], "bin"))

VIDEO_PATH = r"Z:\polikek 7\videoeditor\backend\test_video.mp4"

print("Загрузка модели...")

model = WhisperModel(
    "small",
    device="cuda",
    compute_type="float16"
)

print("Модель загружена.")
print("Начинаем распознавание...")

start = time.time()

segments, info = model.transcribe(
    VIDEO_PATH,
    language="ru"
)

segments = list(segments)

elapsed = time.time() - start

print("\n===== РЕЗУЛЬТАТ =====")
print(f"Длительность видео: {info.duration:.1f} сек.")
print(f"Время обработки: {elapsed:.1f} сек.")
print(f"Скорость: {info.duration / elapsed:.2f}x realtime")
print(f"Количество сегментов: {len(segments)}")

print("\n===== ТЕКСТ =====")

for segment in segments:
    print(f"[{segment.start:.1f}s - {segment.end:.1f}s] {segment.text}")