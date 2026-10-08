export interface CutInterval {
  id: string;
  start: number;
  end: number;
}

export interface VideoInfo {
  filename: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  url: string;
}

export interface ExportJob {
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  error?: string | null;
  filename?: string | null;
  download_url?: string | null;
}
