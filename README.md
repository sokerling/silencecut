# SilenceCut

SilenceCut — локальный видеоредактор для исследования обнаружения и удаления неречевых фрагментов видеозаписей. Он позволяет вручную отметить CUT-интервалы, сохранить разметку и экспортировать видео без отмеченных участков. Исследовательский notebook содержит эксперименты с Faster-Whisper, RMS и Silero VAD; сохранённые результаты включены в репозиторий.

Редактор сейчас работает с ручной разметкой. Автоматический запуск ML-моделей, субтитры и автоматическая разметка в интерфейс не подключены.

## Стек

- Frontend: React, TypeScript, Vite.
- Backend: Python 3.11+, FastAPI, Uvicorn.
- Видео: FFmpeg 7+ и FFprobe, экспорт H.264/AAC.
- Проверки: pytest, Vitest, Playwright; GitHub Actions для Windows и macOS ARM64.

## Основные возможности

- Видеоплеер с play/pause и перемоткой; синхронный playhead на timeline всей записи.
- Создание CUT двумя кликами или протягиванием мышью, в любом порядке границ.
- Перенос интервала, изменение обеих границ, удаление и связанное выделение в списке.
- Точный ввод start/end в секундах и отображение duration.
- Сохранение ручной разметки в `backend/results/ground_truth_intervals.csv`.
- Фоновый экспорт MP4 с прогрессом и скачиванием.

CUT хранятся одним массивом объектов `{id, start, end}`. При экспорте пересекающиеся CUT объединяются, а остальные части изображения и звука склеиваются по одним временным границам. Пользовательские id и исходное видео сохраняются.

## Исходное видео

**Видео и MP4-экспорты исключены из Git.** После клонирования скопируйте своё `test_video.mp4` в `backend/test_video.mp4`. Чтобы использовать сохранённые результаты экспериментов, нужен тот же исходный файл: его SHA-256 указан в `backend/results/experiment_metadata.json`.

Другой локальный файл можно указать через переменную `VIDEOEDITOR_VIDEO_PATH` перед запуском backend. Загрузки видео через интерфейс пока нет.

## Установка на Windows

Установите [Git](https://git-scm.com/downloads/win), [Python](https://www.python.org/downloads/windows/) 3.11+, [Node.js](https://nodejs.org/en/download) 24 LTS (минимум 22.12), [FFmpeg/FFprobe](https://ffmpeg.org/download.html) 7+ и добавьте их в PATH. FFmpeg также обнаруживается в `C:\Program Files\FFmpeg`.

```powershell
git clone https://github.com/sokerling/silencecut.git
cd silencecut
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

Установка создаёт `backend/venv`, если его ещё нет, и устанавливает API-зависимости и frontend через `npm ci`. Существующее рабочее окружение используется повторно. Другой Python можно указать параметром `-Python`. Если есть переносимый Node в `.tools/`, скрипты используют его; на новом компьютере установите Node отдельно.

Поместите видео в `backend/test_video.mp4`. Запустите два терминала из корня проекта.

Терминал 1:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-backend.ps1
```

Терминал 2:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-frontend.ps1
```

## Установка на macOS / MacBook Air M4

Если [Homebrew](https://brew.sh) ещё не установлен, установите его с официального сайта. На Apple Silicon выполняйте команды в обычном Terminal без Rosetta.

```bash
brew install python@3.11 node@24 ffmpeg
git clone https://github.com/sokerling/silencecut.git
cd silencecut
bash scripts/setup.sh
```

Скрипты учитывают Homebrew в `/opt/homebrew` и versioned Node/Python. Установка создаёт местное `backend/venv`. **Не копируйте Windows venv на Mac**: переносите исходники через Git, а окружение создавайте на каждой машине. Редактору не нужны CUDA, PyTorch или ML-модели.

Скопируйте исходное видео в `backend/test_video.mp4`, затем запустите два терминала в папке `silencecut`.

Терминал 1:

```bash
bash scripts/start-backend.sh
```

Терминал 2:

```bash
bash scripts/start-frontend.sh
```

## Адреса и управление

- Редактор: **http://127.0.0.1:5173/**.
- API: http://127.0.0.1:8000/api/health.
- Документация API: http://127.0.0.1:8000/docs.

Ctrl+C в терминале останавливает соответствующий сервер. Повторно устанавливать зависимости при каждом запуске не нужно.

В режиме **CUT** два клика или протягивание создают интервал. Центр интервала служит для переноса, боковые ручки — для изменения границ. Esc отменяет незавершённое создание, Delete удаляет выделенный CUT; внутри поля ввода Delete редактирует текст. Точные значения списка применяются после Enter или выхода из поля.

В режиме **Перемотка** клики и протягивание меняют момент видео. На timeline работают стрелки клавиатуры; Shift увеличивает шаг. Для коротких пауз на длинной записи удобен точный ввод секунд в списке.

**Сохранить CUT** заменяет только `ground_truth_intervals.csv`, столбцы `id,start,end,duration`. Пустой список сохраняется как заголовок без интервалов. Остальные исследовательские CSV не изменяются. Редактор пока не загружает этот CSV обратно: обновление страницы сбрасывает массив CUT в интерфейсе.

**Экспорт MP4** сохраняет отдельный файл в `backend/exports/`. Частота кадров сохраняется, видео и аудио перекодируются; точность границ ограничена дискретностью кадров и аудиосэмплов. Удаление всего ролика отклоняется. Очередь обрабатывает один экспорт за раз. Статусы задач хранятся в памяти API: не перезапускайте backend во время экспорта. Уже готовые файлы остаются.

## Структура

```text
silencecut/
├── frontend/                   # React/TypeScript, timeline, unit/E2E tests
├── backend/
│   ├── app/                    # FastAPI и FFmpeg
│   ├── tests/                  # API и проверка синхронности экспорта
│   ├── requirements-api.txt
│   ├── test_venv.ipynb         # Сохранённое исследование
│   ├── test_whisper.py         # Исторический GPU-тест Windows
│   ├── results/               # CSV и JSON экспериментов
│   ├── test_video.mp4          # Локальный файл, исключён из Git
│   ├── venv/                   # Локальное окружение, исключено из Git
│   └── exports/                # Создаётся при экспорте, исключена из Git
├── scripts/                    # Установка/запуск Windows и macOS
└── .github/workflows/          # Проверки на обеих ОС
```

## Исследовательские результаты

В репозитории сохранены notebook с выводами, таблицы Whisper, RMS (−40 dBFS), Silero VAD, выбранные участки для Ground Truth и JSON с параметрами/результатами. Числа и параметры не адаптируются под новую машину и не пересчитываются при установке редактора.

Исторические GPU-ячейки notebook и `test_whisper.py` используют CUDA и настройки Windows. Они сохранены без изменений; их полный запуск на Apple Silicon не входит в установку редактора. Для сравнения методов можно использовать сохранённые CSV/JSON. API-установка не скачивает ML-пакеты и модели.

## Проверки

API-тесты создают только синтетические видео и временные папки; настоящий `backend/results` не используется для записи.

Windows:

```powershell
cd backend
.\venv\Scripts\python.exe -m pytest tests -q
```

macOS:

```bash
cd backend
./venv/bin/python -m pytest tests -q
```

Frontend из `frontend/`, если Node/npm есть в PATH:

```bash
npm test
npm run build
```

Браузерные проверки используют отдельные порты **8001/5174** и временный 12-секундный ролик. На macOS в трёх терминалах из корня:

```bash
# Терминал 1
bash scripts/start-test-backend.sh

# Терминал 2
VIDEOEDITOR_API_PROXY=http://127.0.0.1:8001 PORT=5174 bash scripts/start-frontend.sh

# Терминал 3
export VIDEOEDITOR_E2E_RESULTS_DIR="$PWD/backend/.editor_test_e2e/results"
cd frontend
npx playwright install chromium  # Если нет Chrome/Edge
npx playwright test
```

Windows: в первом терминале запустите `scripts/start-test-backend.ps1`; во втором задайте `$env:VIDEOEDITOR_API_PROXY = 'http://127.0.0.1:8001'` и запустите `scripts/start-frontend.ps1 -Port 5174`; в третьем задайте `VIDEOEDITOR_E2E_RESULTS_DIR`, перейдите в `frontend` и выполните `npx playwright test`. При отсутствии Node в PATH можно запустить местный `.tools/node-v24.21.0-win-x64/node.exe` с `frontend/node_modules/@playwright/test/cli.js`.

По умолчанию браузерные тесты используют тестовый frontend на 5174 и отказываются работать с исходным исследовательским видео.
