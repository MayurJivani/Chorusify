/**
 * Draws a run's result as an image.
 *
 * The emoji grid works anywhere text does, but it is invisible on Instagram and squashed on
 * Twitter, which are the places a result actually spreads. This renders the same information as
 * a picture instead.
 *
 * Drawn on a canvas in the browser rather than generated server-side: an image endpoint would
 * need a rendering library in the container and a request per share, for something the client
 * already has every value for.
 */

/** Square, because that is what survives both a feed and a story crop. */
const SIZE = 1080;

export interface ResultCardOptions {
  /** "Queen", "Top Hits 2024", "Survival". */
  subject: string;
  /** The headline figure: "7/10" for a run, "23" for a streak. */
  headline: string;
  /** Sits under the headline: "songs in a row", "in 1m 20s". */
  caption?: string;
  /** One entry per song, in order. Omitted for modes without a per-song grid. */
  history?: boolean[];
  /** Padded out to this many squares so an unfinished run still reads out of the full length. */
  totalRounds?: number;
}

const BACKGROUND = '#0b0b0f';
const PURPLE = '#a78bfa';
const GREEN = '#22c55e';
const RED = '#ef4444';
const EMPTY = '#26262e';
const MUTED = '#94a3b8';

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

/** The grid, laid out to fill the width whatever the run length. */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  history: boolean[],
  totalRounds: number,
  centerY: number,
): void {
  const count = Math.max(totalRounds, history.length, 1);
  const perRow = Math.min(count, 10);
  const rows = Math.ceil(count / perRow);

  const gap = 16;
  const available = SIZE - 160;
  const cell = Math.min(72, (available - gap * (perRow - 1)) / perRow);
  const gridWidth = perRow * cell + (perRow - 1) * gap;
  const startX = (SIZE - gridWidth) / 2;
  const startY = centerY - (rows * cell + (rows - 1) * gap) / 2;

  for (let i = 0; i < count; i += 1) {
    const answered = history[i];
    ctx.fillStyle = answered === undefined ? EMPTY : answered ? GREEN : RED;
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    roundedRect(
      ctx,
      startX + col * (cell + gap),
      startY + row * (cell + gap),
      cell,
      cell,
      cell * 0.28,
    );
  }
}

/** A vinyl record, the same motif as the logo. */
function drawDisc(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  ctx.fillStyle = '#141418';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#202027';
  ctx.lineWidth = 2;
  for (const r of [0.82, 0.68, 0.54]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = PURPLE;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.34, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = BACKGROUND;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.07, 0, Math.PI * 2);
  ctx.fill();
}

const FONT = '"Geist Variable", system-ui, -apple-system, "Segoe UI", sans-serif';

export async function renderResultCard(options: ResultCardOptions): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Without this the first render can fall back to a system font mid-draw and look nothing like
  // the site, because the webfont has not finished loading.
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Falling back to a system font is fine; a missing font is not worth failing the share.
    }
  }

  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const glow = ctx.createRadialGradient(
    SIZE / 2,
    SIZE * 0.42,
    0,
    SIZE / 2,
    SIZE * 0.42,
    SIZE * 0.6,
  );
  glow.addColorStop(0, 'rgba(124, 58, 237, 0.20)');
  glow.addColorStop(1, 'rgba(124, 58, 237, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.textAlign = 'center';

  drawDisc(ctx, SIZE / 2, 190, 76);

  ctx.fillStyle = '#ffffff';
  ctx.font = `800 44px ${FONT}`;
  ctx.fillText('CHORUSIFY', SIZE / 2, 320);

  ctx.fillStyle = MUTED;
  ctx.font = `500 38px ${FONT}`;
  // Long artist names would otherwise run off both edges.
  const subject =
    options.subject.length > 28 ? `${options.subject.slice(0, 27)}…` : options.subject;
  ctx.fillText(subject, SIZE / 2, 396);

  ctx.fillStyle = '#ffffff';
  ctx.font = `900 190px ${FONT}`;
  ctx.fillText(options.headline, SIZE / 2, 590);

  if (options.caption) {
    ctx.fillStyle = MUTED;
    ctx.font = `500 36px ${FONT}`;
    ctx.fillText(options.caption, SIZE / 2, 654);
  }

  if (options.history && options.history.length > 0) {
    drawGrid(ctx, options.history, options.totalRounds ?? options.history.length, 800);
  }

  ctx.fillStyle = PURPLE;
  ctx.font = `600 32px ${FONT}`;
  ctx.fillText('Can you beat it?', SIZE / 2, 990);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

/**
 * Shares the image through the OS share sheet, falling back to a download.
 *
 * `canShare` is checked with the actual file: browsers advertise `navigator.share` while still
 * refusing file payloads, and finding that out by having the call reject would lose the share.
 */
export async function shareResultCard(blob: Blob, filename: string, text: string): Promise<void> {
  const file = new File([blob], filename, { type: 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return;
    } catch {
      // Dismissed or unsupported: fall through and save it instead.
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
