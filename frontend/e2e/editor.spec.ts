import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const fixtureDuration = 12;

async function trackBox(page: Page) {
  const track = page.getByTestId('timeline');
  await track.scrollIntoViewIfNeeded();
  const box = await track.boundingBox();
  if (!box) throw new Error('Timeline is not visible');
  return box;
}

async function clickAt(page: Page, seconds: number) {
  const box = await trackBox(page);
  await page.mouse.click(box.x + box.width * seconds / fixtureDuration, box.y + box.height / 2);
}

async function dragRange(page: Page, from: number, to: number) {
  const box = await trackBox(page);
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * from / fixtureDuration, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to / fixtureDuration, y, { steps: 12 });
  await page.mouse.up();
}

async function dragBySeconds(page: Page, target: Locator, delta: number) {
  const track = await trackBox(page);
  const box = await target.boundingBox();
  if (!box) throw new Error('CUT or its handle is not visible');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + track.width * delta / fixtureDuration, y, { steps: 12 });
  await page.mouse.up();
}

async function cutRange(cut: Locator) {
  return cut.evaluate((element, duration) => {
    const style = (element as HTMLElement).style;
    const start = parseFloat(style.left) * duration / 100;
    return { start, end: start + parseFloat(style.width) * duration / 100 };
  }, fixtureDuration);
}

async function expectRange(cut: Locator, start: number, end: number) {
  await expect.poll(async () => (await cutRange(cut)).start).toBeCloseTo(start, 1);
  await expect.poll(async () => (await cutRange(cut)).end).toBeCloseTo(end, 1);
}

async function createCut(page: Page, start: number, end: number) {
  await clickAt(page, start);
  await clickAt(page, end);
}

test.beforeEach(async ({ page, request }) => {
  // Use an isolated Vite server whose proxy points to the fixture backend.
  // Checking that server's own API also protects native browser downloads.
  const response = await request.get('/api/video');
  expect(response.ok(), 'Start the isolated fixture backend before running E2E').toBeTruthy();
  const videoInfo = await response.json() as { duration: number };
  expect(videoInfo.duration, 'Refusing to test save/export against the original research video').toBeCloseTo(fixtureDuration, 1);

  await page.goto('/');
  await expect(page.getByTestId('timeline')).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.locator('video').evaluate((video) => video.duration)).toBeCloseTo(fixtureDuration, 1);
  await expect(page.getByTestId('cut-interval')).toHaveCount(0);
});

test('CUT creation, selection, resizing, movement limits and deletion', async ({ page }) => {
  // Reversed clicks must still produce sorted boundaries.
  await createCut(page, 6, 2);
  await expect(page.getByTestId('cut-interval')).toHaveCount(1);
  const firstId = await page.getByTestId('cut-interval').first().getAttribute('data-cut-id');
  const first = page.locator(`[data-testid="cut-interval"][data-cut-id="${firstId}"]`);
  await expectRange(first, 2, 6);

  await dragRange(page, 8, 10);
  await dragRange(page, 11.5, 10.5);
  await expect(page.getByTestId('cut-interval')).toHaveCount(3);
  const second = page.getByTestId('cut-interval').nth(1);
  const third = page.getByTestId('cut-interval').nth(2);
  await expectRange(second, 8, 10);
  await expectRange(third, 10.5, 11.5);
  await expect(page.getByTestId('cut-row')).toHaveCount(3);

  const firstRow = page.locator(`[data-testid="cut-row"][data-cut-id="${firstId}"]`);
  await firstRow.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(firstRow).toHaveClass(/selected/);
  const secondId = await second.getAttribute('data-cut-id');
  const secondRow = page.locator(`[data-testid="cut-row"][data-cut-id="${secondId}"]`);
  await second.click();
  await expect(secondRow).toHaveClass(/selected/);
  await expect(firstRow).not.toHaveClass(/selected/);

  await firstRow.click();
  await dragBySeconds(page, first.getByTestId('left-handle'), -1);
  await expectRange(first, 1, 6);
  await dragBySeconds(page, first.getByTestId('right-handle'), 1);
  await expectRange(first, 1, 7);
  const length = (await cutRange(first)).end - (await cutRange(first)).start;
  await dragBySeconds(page, first, -4);
  await expectRange(first, 0, length);
  await dragBySeconds(page, first, 9);
  await expectRange(first, fixtureDuration - length, fixtureDuration);

  // An input holding focus must receive Delete rather than removing its CUT.
  const editable = page.locator('input').first();
  if (await editable.count()) {
    await editable.focus();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('cut-interval')).toHaveCount(3);
  }
  await page.getByTestId('timeline').focus();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('cut-interval')).toHaveCount(2);
  await expect(firstRow).toHaveCount(0);
});

test('video seeking, playhead sync and play/pause', async ({ page }) => {
  await createCut(page, 2, 4);
  const cut = page.getByTestId('cut-interval');
  await expectRange(cut, 2, 4);
  await page.getByRole('button', { name: /Перемотка/i }).click();
  await clickAt(page, 3);
  await expect.poll(() => page.locator('video').evaluate((video) => video.currentTime)).toBeCloseTo(3, 1);
  await expectRange(cut, 2, 4);
  await clickAt(page, 5);
  await expect.poll(() => page.locator('video').evaluate((video) => video.currentTime)).toBeCloseTo(5, 1);
  await expect.poll(() => page.getByTestId('playhead').evaluate((element) => parseFloat((element as HTMLElement).style.left)))
    .toBeCloseTo(100 * 5 / fixtureDuration, 0);
  await expect(page.getByTestId('cut-interval')).toHaveCount(1);

  await page.getByRole('button', { name: /Воспроизвести/i }).click();
  await expect.poll(() => page.locator('video').evaluate((video) => video.paused)).toBe(false);
  await expect.poll(() => page.locator('video').evaluate((video) => video.currentTime)).toBeGreaterThan(5.1);
  await page.getByRole('button', { name: /Пауза/i }).click();
  await expect.poll(() => page.locator('video').evaluate((video) => video.paused)).toBe(true);

  await page.getByTestId('timeline').focus();
  const previous = await page.locator('video').evaluate((video) => video.currentTime);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.locator('video').evaluate((video) => video.currentTime)).toBeCloseTo(previous + 1, 1);
});

test('save actual fixture CSV and export/download a continuous MP4', async ({ page }) => {
  await createCut(page, 2, 4);
  await createCut(page, 6, 7);
  await expect(page.getByTestId('cut-interval')).toHaveCount(2);

  const savedResponse = page.waitForResponse((response) => response.url().endsWith('/api/cuts') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Сохранить/i }).click();
  const saved = await savedResponse;
  expect(saved.ok()).toBeTruthy();
  const payload = saved.request().postDataJSON() as { intervals: { id: string; start: number; end: number }[] };
  expect(payload.intervals).toHaveLength(2);
  expect(new Set(payload.intervals.map((interval) => interval.id)).size).toBe(2);
  const body = await saved.json() as { count: number; filename: string };
  expect(body.count).toBe(2);
  expect(body.filename).toBe('ground_truth_intervals.csv');

  const fixtureResults = process.env.VIDEOEDITOR_E2E_RESULTS_DIR;
  if (fixtureResults) {
    const lines = readFileSync(join(fixtureResults, body.filename), 'utf8').trim().split(/\r?\n/);
    expect(lines[0]).toBe('id,start,end,duration');
    expect(lines).toHaveLength(3);
    const ranges = lines.slice(1).map((line) => line.split(',').slice(1).map(Number));
    expect(ranges[0][0]).toBeCloseTo(2, 1);
    expect(ranges[0][1]).toBeCloseTo(4, 1);
    expect(ranges[1][0]).toBeCloseTo(6, 1);
    expect(ranges[1][1]).toBeCloseTo(7, 1);
    expect(ranges[0][2] + ranges[1][2]).toBeCloseTo(3, 1);
  }

  const exportResponse = page.waitForResponse((response) => response.url().endsWith('/api/export') && response.request().method() === 'POST');
  await page.getByRole('button', { name: /Экспорт MP4/i }).click();
  const started = await exportResponse;
  expect(started.status()).toBe(202);
  expect((await started.json() as { job_id: string }).job_id).toBeTruthy();

  const link = page.getByRole('link', { name: /Скачать MP4/i });
  await expect(link).toBeVisible({ timeout: 60_000 });
  await expect(link).toHaveAttribute('href', /^\/api\/exports\/[a-f0-9]+\/download$/);
  const downloadReady = page.waitForEvent('download');
  await link.click();
  const download = await downloadReady;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/^edited_.*\.mp4$/);
  const destination = join(test.info().outputDir, 'exported.mp4');
  await download.saveAs(destination);
  const size = readFileSync(destination).length;
  expect(size).toBeGreaterThan(1000);
  const windowsFfprobe = 'C:/Program Files/FFmpeg/ffprobe.exe';
  const ffprobe = process.env.FFPROBE_BINARY ?? process.env.VIDEO_EDITOR_FFPROBE
    ?? (process.platform === 'win32' && existsSync(windowsFfprobe) ? windowsFfprobe : 'ffprobe');
  const info = JSON.parse(execFileSync(ffprobe, [
    '-v', 'error', '-show_streams', '-show_format', '-of', 'json', destination,
  ], { encoding: 'utf8' })) as {
    format: { duration: string };
    streams: { codec_type: string; duration: string }[];
  };
  expect(Number(info.format.duration)).toBeCloseTo(9, 1);
  const video = info.streams.find((stream) => stream.codec_type === 'video');
  const audio = info.streams.find((stream) => stream.codec_type === 'audio');
  expect(video).toBeTruthy();
  expect(audio).toBeTruthy();
  expect(Math.abs(Number(video!.duration) - Number(audio!.duration))).toBeLessThan(0.1);
});
