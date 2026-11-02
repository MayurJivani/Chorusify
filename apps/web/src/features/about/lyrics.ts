export interface LyricSection {
  title: string;
  lines: string[];
}

/** The short version, written as a song sheet: one idea a line. */
export const LYRICS: LyricSection[] = [
  {
    title: 'How it works',
    lines: [
      'Hear one second of a song.',
      'Name it, if you can.',
      'Hear more, if you need it.',
      'The sooner you get it, the more it is worth.',
      'Hearing more is free, except on the dailies.',
    ],
  },
  {
    title: 'Why we made it',
    lines: ['For everyone who finishes the lyric before the singer does.'],
  },
];

/** Which line a scroll position is on, and how far through it, each from 0. */
export function lineAt(progress: number, lineCount: number): { index: number; through: number } {
  const position = Math.min(1, Math.max(0, progress)) * lineCount;
  const index = Math.min(lineCount - 1, Math.floor(position));
  return { index, through: Math.min(1, position - index) };
}
