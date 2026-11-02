/** True while a snippet is really playing. Set by SnippetPlayer, read each frame by the ridges. */
export const snippetPlayback = { playing: false };

/** Soft, repeatable bumps: the same line and moment always give the same shape. */
function bump(x: number, line: number, time: number): number {
  const wave = (f: number, p: number) => Math.sin(x * f + line * p + time);
  return Math.abs(wave(19, 1.7) * 0.5 + wave(41, 2.9) * 0.3 + wave(83, 0.7) * 0.2);
}

/** A ridge's height at x (0 to 1): tall in the middle, flat at the edges, scaled by `energy`. */
export function ridgeHeight(x: number, line: number, time: number, energy: number): number {
  const centre = Math.exp(-(((x - 0.5) / 0.17) ** 2));
  return centre * (0.12 + bump(x, line, time) ** 2) * energy;
}

/** Sizes the canvas to its element, then draws ridges back to front, so nearer ones hide farther. */
export function drawRidges(
  canvas: HTMLCanvasElement,
  {
    count,
    gap,
    lift,
    time,
    ground,
  }: { count: number; gap: number; lift: number; time: number; ground: string },
): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
  if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.lineJoin = 'round';
  const steps = 110;
  for (let line = 0; line < count; line += 1) {
    const y = height * 0.97 - (count - 1 - line) * gap;
    context.beginPath();
    context.moveTo(0, y);
    for (let s = 0; s <= steps; s += 1) {
      const x = s / steps;
      context.lineTo(x * width, y - ridgeHeight(x, line * 1.3, time, lift));
    }
    context.lineTo(width, y + 2);
    context.lineTo(0, y + 2);
    context.closePath();
    context.fillStyle = ground;
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = line === count - 1 ? '#a78bfa' : 'rgba(255,255,255,0.72)';
    context.stroke();
  }
}
