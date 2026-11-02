export interface LyricSection {
  title: string;
  lines: string[];
}

/** The About page, written as a song sheet: short lines, one idea each. */
export const LYRICS: LyricSection[] = [
  {
    title: 'How it works',
    lines: [
      'You start with a short snippet of a song.',
      'Name it in as few seconds as you can.',
      'The earlier you get it, the more the round is worth.',
      'Hear more stretches the clip: one second, then two, four, seven, and so on.',
      'In every mode except the daily, it is free and costs no guess.',
      'So there is never a reason to guess blind.',
      'On the daily, an attempt is what grows the snippet, so it uses a try.',
    ],
  },
  {
    title: 'Ways to play',
    lines: [
      'Daily: five songs a day, the same for everyone. Keep your streak alive.',
      'Desi Daily: five Indian songs, with its own streak.',
      'Artist Mode: pick any artist and name ten songs from their discography.',
      'Multiplayer: share a room by QR or code and race friends on the same snippet.',
      'Fastest correct answer scores most.',
      'The host picks up to 25 songs, and can switch artist or category between games without anyone leaving.',
      'Categories: ten songs from one chart, year or genre, every track by a different artist.',
      'Soundtracks: the answer is what the music is from, not the song.',
      'Hollywood and Bollywood films, video games, anime, and orchestral film scores.',
      'Play soundtracks solo, in a room, or as a rated duel on its own ladder.',
      'Survival: endless songs. One wrong answer ends the run.',
      'Guess the Year: hear a song and place it in time. Harder than it sounds.',
      'Duels: rated 1v1 over the same ten songs. Win and your rating climbs.',
    ],
  },
  {
    title: 'Leaderboards',
    lines: [
      'Artist and Category runs are ranked on everything you have played, not one lucky run.',
      'So playing more counts as well as scoring well.',
      'Survival ranks your longest streak.',
      'Only registered accounts appear: a guest is a browser cookie, too unstable to rank.',
    ],
  },
  {
    title: 'Music credit',
    lines: [
      'Song previews are provided by Deezer.',
      'All rights to the recordings belong to their artists and labels.',
      'Chorusify only plays short preview clips for the guessing game.',
    ],
  },
  {
    title: 'Your data',
    lines: [
      'You can play as a guest with no account.',
      'Your streak and stats are tied to your browser session.',
      'An account keeps your stats permanently, across devices, and puts you on the leaderboards.',
    ],
  },
  {
    title: 'Built by',
    lines: ['Mayur Jivani and Ritwik Garg.'],
  },
];

/** Which line a scroll position is on, and how far through it, each from 0. */
export function lineAt(progress: number, lineCount: number): { index: number; through: number } {
  const position = Math.min(1, Math.max(0, progress)) * lineCount;
  const index = Math.min(lineCount - 1, Math.floor(position));
  return { index, through: Math.min(1, position - index) };
}
