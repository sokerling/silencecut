import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, postJson } from './api';
import { clamp, formatTime, MIN_INTERVAL, resizeInterval, totalCutDuration } from './intervals';
import Timeline from './Timeline';
import type { TimelineMode } from './Timeline';
import type { CutInterval, ExportJob, VideoInfo } from './types';

function TimeInput({ value, min, max, label, onCommit }: {
  value: number;
  min: number;
  max: number;
  label: string;
  onCommit: (time: number) => void;
}) {
  const [draft, setDraft] = useState(value.toFixed(3));
  useEffect(() => setDraft(value.toFixed(3)), [value]);

  function commit() {
    const number = draft.trim() === '' ? NaN : Number(draft);
    if (Number.isFinite(number)) onCommit(clamp(number, min, max));
    setDraft((Number.isFinite(number) ? clamp(number, min, max) : value).toFixed(3));
  }

  return (
    <input
      type="number"
      aria-label={label}
      value={draft}
      min={min}
      max={max}
      step="0.05"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setDraft(value.toFixed(3));
          event.stopPropagation();
        }
      }}
    />
  );
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'Не удалось выполнить действие.';
}

export default function App() {
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cuts, setCuts] = useState<CutInterval[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<TimelineMode>('cut');
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [job, setJob] = useState<ExportJob | null>(null);
  const [startingExport, setStartingExport] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const duration = videoInfo?.duration ?? 0;
  const removedDuration = totalCutDuration(cuts);
  const sortedCuts = [...cuts].sort((a, b) => a.start - b.start || a.end - b.end);
  const selectedCut = cuts.find((cut) => cut.id === selectedId);
  const exporting = startingExport || job?.status === 'queued' || job?.status === 'running';

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<VideoInfo>('/api/video', { signal: controller.signal })
      .then((info) => {
        if (!Number.isFinite(info.duration) || info.duration <= 0) throw new Error('Не удалось прочитать длительность видео.');
        setVideoInfo(info);
      })
      .catch((problem: unknown) => {
        if (!controller.signal.aborted) setError(messageOf(problem));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const update = () => {
      if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const deleteCut = useCallback((id: string) => {
    setCuts((previous) => previous.filter((cut) => cut.id !== id));
    setSelectedId((selected) => selected === id ? null : selected);
    setNotice(null);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault();
        deleteCut(selectedId);
      }
      if (event.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, deleteCut]);

  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await apiRequest<ExportJob>(`/api/exports/${encodeURIComponent(job.job_id)}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setJob(result);
        if (result.status === 'queued' || result.status === 'running') timeout = setTimeout(poll, 1000);
      } catch (problem) {
        if (!controller.signal.aborted) {
          setJob((previous) => previous ? { ...previous, status: 'failed', error: messageOf(problem) } : null);
        }
      }
    };
    timeout = setTimeout(poll, 300);
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [job?.job_id, job?.status]);

  function seek(time: number) {
    if (!videoRef.current) return;
    const target = clamp(time, 0, duration);
    videoRef.current.currentTime = target;
    setCurrentTime(target);
  }

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try { await video.play(); }
      catch (problem) { setError(messageOf(problem)); }
    } else video.pause();
  }

  function createCut(start: number, end: number) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < MIN_INTERVAL) return;
    const cut = { id: crypto.randomUUID(), start, end };
    setCuts((previous) => [...previous, cut]);
    setSelectedId(cut.id);
    setNotice(null);
  }

  function updateCut(updated: CutInterval) {
    setCuts((previous) => previous.map((cut) => cut.id === updated.id ? updated : cut));
    setNotice(null);
  }

  async function saveCuts() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await postJson<{ filename: string; count: number }>('/api/cuts', { intervals: cuts });
      setNotice(`Сохранено: ${result.count} интервалов → ${result.filename}`);
    } catch (problem) { setError(messageOf(problem)); }
    finally { setSaving(false); }
  }

  async function exportVideo() {
    setStartingExport(true);
    setError(null);
    try {
      const result = await postJson<ExportJob>('/api/export', { intervals: cuts });
      setJob(result);
    } catch (problem) { setError(messageOf(problem)); }
    finally { setStartingExport(false); }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand"><span className="brand-icon">▥</span><span>Silence<span className="brand-accent">Cut</span></span></div>
        <span className="workspace-label">Ручная разметка</span>
        <div className="header-actions">
          <button className="button secondary" onClick={saveCuts} disabled={!videoInfo || saving}>
            {saving ? 'Сохраняем…' : 'Сохранить CUT'}
          </button>
          <button
            className="button primary"
            onClick={exportVideo}
            disabled={!videoInfo || exporting || duration - removedDuration < MIN_INTERVAL}
          >{exporting ? 'Экспортируем…' : 'Экспорт MP4'} <span aria-hidden="true">↗</span></button>
        </div>
      </header>

      <main>
        <div className="project-heading">
          <div>
            <p className="eyebrow">ИСХОДНОЕ ВИДЕО</p>
            <h1>{videoInfo?.filename ?? 'test_video.mp4'}</h1>
          </div>
          <div className="video-meta">
            {videoInfo && <><span>{videoInfo.width} × {videoInfo.height}</span><span>{videoInfo.fps.toFixed(2)} fps</span><span>{formatTime(duration)}</span></>}
          </div>
        </div>

        {error && <div className="alert error" role="alert"><span>{error}</span><button aria-label="Закрыть сообщение" onClick={() => setError(null)}>×</button></div>}
        {notice && <div className="alert success" role="status">{notice}</div>}

        <section className="preview-section" aria-label="Видеоплеер">
          <div className="video-surface">
            {videoInfo ? (
              <video
                data-testid="video-player"
                ref={videoRef}
                src={videoInfo.url}
                controls
                preload="metadata"
                playsInline
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onError={() => setError('Видео не загрузилось. Проверьте доступность backend и файла test_video.mp4.')}
              />
            ) : (
              <div className="video-placeholder">{loading ? 'Открываем видео…' : 'Запустите backend, затем обновите страницу.'}</div>
            )}
          </div>
          <div className="transport">
            <div className="playback-buttons">
              <button title="Назад на 5 секунд" aria-label="Назад на 5 секунд" onClick={() => seek(currentTime - 5)} disabled={!videoInfo}>−5</button>
              <button className="play-button" aria-label={playing ? 'Пауза' : 'Воспроизвести'} onClick={togglePlayback} disabled={!videoInfo}>{playing ? 'Ⅱ' : '▶'}</button>
              <button title="Вперёд на 5 секунд" aria-label="Вперёд на 5 секунд" onClick={() => seek(currentTime + 5)} disabled={!videoInfo}>+5</button>
            </div>
            <div className="timecode" data-testid="timecode">{formatTime(currentTime, true)} <span>/ {formatTime(duration, true)}</span></div>
            <span className="preview-note">Просмотр исходника</span>
          </div>
        </section>

        <section className="timeline-section" aria-label="Монтажная шкала">
          <div className="section-toolbar">
            <div className="section-title"><span className="eyebrow">TIMELINE</span><span className="duration-badge">Весь ролик · {formatTime(duration)}</span></div>
            <div className="timeline-tools">
              <div className="segmented-control" aria-label="Режим timeline">
                <button className={mode === 'seek' ? 'active' : ''} aria-pressed={mode === 'seek'} onClick={() => setMode('seek')}>↔ Перемотка</button>
                <button className={mode === 'cut' ? 'active' : ''} aria-pressed={mode === 'cut'} onClick={() => setMode('cut')}>✂ CUT</button>
              </div>
              <button className="button delete-selected" disabled={!selectedId} onClick={() => selectedId && deleteCut(selectedId)}>Удалить <kbd>Del</kbd></button>
            </div>
          </div>
          {videoInfo ? <Timeline
            duration={duration}
            currentTime={currentTime}
            cuts={cuts}
            selectedId={selectedId}
            mode={mode}
            onSeek={seek}
            onSelect={setSelectedId}
            onCreate={createCut}
            onUpdate={updateCut}
          /> : <div className="empty-timeline">Шкала появится после загрузки видео</div>}
        </section>

        <section className="cuts-section" aria-label="Список CUT-интервалов">
          <div className="cuts-heading">
            <div><h2>CUT-интервалы <span className="count-badge">{cuts.length}</span></h2><p>Границы в секундах. Для точной разметки измените значения вручную.</p></div>
            <div className="cut-totals"><span>Удалить <strong>{removedDuration.toFixed(2)} с</strong></span><span>После экспорта <strong>{formatTime(Math.max(0, duration - removedDuration), true)}</strong></span></div>
          </div>
          {cuts.length === 0 ? (
            <div className="empty-cuts"><span className="empty-icon" aria-hidden="true">[ ↔ ]</span><h3>Отметьте первый CUT</h3><p>Выберите две границы на timeline или протяните диапазон мышью.</p></div>
          ) : (
            <div className="table-scroll">
              <table className="cuts-table">
                <thead><tr><th>Интервал</th><th>start, с</th><th>end, с</th><th>duration, с</th><th><span className="sr-only">Действия</span></th></tr></thead>
                <tbody>
                  {sortedCuts.map((cut, index) => (
                    <tr
                      key={cut.id}
                      className={selectedId === cut.id ? 'selected' : ''}
                      data-testid="cut-row"
                      data-cut-id={cut.id}
                      data-selected={selectedId === cut.id}
                      onClick={() => setSelectedId(cut.id)}
                      onFocus={() => setSelectedId(cut.id)}
                    >
                      <td><button className="row-select" aria-pressed={selectedId === cut.id} aria-label={`Выбрать CUT ${index + 1}`} onClick={() => setSelectedId(cut.id)}><i className="legend cut" />CUT {String(index + 1).padStart(2, '0')}</button></td>
                      <td><TimeInput value={cut.start} min={0} max={cut.end - MIN_INTERVAL} label={`Начало CUT ${index + 1}, секунды`} onCommit={(value) => updateCut(resizeInterval(cut, 'left', value, duration))} /></td>
                      <td><TimeInput value={cut.end} min={cut.start + MIN_INTERVAL} max={duration} label={`Конец CUT ${index + 1}, секунды`} onCommit={(value) => updateCut(resizeInterval(cut, 'right', value, duration))} /></td>
                      <td className="duration-cell">{(cut.end - cut.start).toFixed(3)}</td>
                      <td className="row-actions"><button aria-label={`Перейти к началу CUT ${index + 1}`} title="К началу интервала" onClick={() => seek(cut.start)}>↦</button><button aria-label={`Удалить CUT ${index + 1}`} title="Удалить интервал" onClick={(event) => { event.stopPropagation(); deleteCut(cut.id); }}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {selectedCut && <p className="selection-note">Выбран CUT: {formatTime(selectedCut.start, true)} — {formatTime(selectedCut.end, true)}. Переносите его целиком или двигайте границы на timeline.</p>}
          {cuts.length > 1 && removedDuration < cuts.reduce((sum, cut) => sum + cut.end - cut.start, 0) - 0.001 && <p className="selection-note">Пересекающиеся CUT удаляются как один общий диапазон.</p>}
        </section>

        {job && <section className={`export-status ${job.status}`} aria-label="Статус экспорта" aria-live="polite">
          <div>
            <strong>{job.status === 'completed' ? 'Экспорт готов' : job.status === 'failed' ? 'Экспорт не завершён' : 'Создаём MP4'}</strong>
            <p>{job.status === 'failed' ? job.error : job.status === 'completed' ? job.filename : 'Удаляем отмеченные CUT и соединяем оставшееся видео со звуком.'}</p>
          </div>
          {job.status === 'queued' || job.status === 'running'
            ? <div className="export-progress"><progress max={100} value={clamp(job.progress ?? 0, 0, 100)} /><span>{Math.round(job.progress ?? 0)}%</span></div>
            : job.status === 'completed' && job.download_url
              ? <a className="button primary" href={job.download_url} download>Скачать MP4 ↓</a>
              : null}
        </section>}
      </main>
      <footer><span>Ручная разметка неречевых фрагментов</span><span>CUT сохраняются только по кнопке «Сохранить CUT»</span></footer>
    </div>
  );
}
