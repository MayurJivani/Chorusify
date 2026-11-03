/** The avatars a player can pick. Ids match AVATARS on the server, which drops anything else. */
export const AVATARS = [
  { id: 'guitar', glyph: '🎸', label: 'Guitar', hue: 12 },
  { id: 'mic', glyph: '🎤', label: 'Microphone', hue: 330 },
  { id: 'headphones', glyph: '🎧', label: 'Headphones', hue: 265 },
  { id: 'drum', glyph: '🥁', label: 'Drum', hue: 30 },
  { id: 'piano', glyph: '🎹', label: 'Keys', hue: 220 },
  { id: 'sax', glyph: '🎷', label: 'Saxophone', hue: 45 },
  { id: 'trumpet', glyph: '🎺', label: 'Trumpet', hue: 52 },
  { id: 'violin', glyph: '🎻', label: 'Violin', hue: 18 },
  { id: 'vinyl', glyph: '💿', label: 'Record', hue: 280 },
  { id: 'cassette', glyph: '📼', label: 'Cassette', hue: 195 },
  { id: 'radio', glyph: '📻', label: 'Radio', hue: 160 },
  { id: 'notes', glyph: '🎶', label: 'Notes', hue: 300 },
  { id: 'maracas', glyph: '🪇', label: 'Maracas', hue: 95 },
  { id: 'banjo', glyph: '🪕', label: 'Banjo', hue: 35 },
  { id: 'accordion', glyph: '🪗', label: 'Accordion', hue: 0 },
  { id: 'speaker', glyph: '🔊', label: 'Speaker', hue: 185 },
] as const;

export type AvatarId = (typeof AVATARS)[number]['id'];
export const avatarById = (id: string | null | undefined) => AVATARS.find((a) => a.id === id);

const STORE = 'chorusify-avatar';
export function savedAvatar(): AvatarId {
  try {
    const id = localStorage.getItem(STORE);
    if (avatarById(id)) return id as AvatarId;
  } catch {
    /* storage blocked: fall through to a random one */
  }
  return AVATARS[Math.floor(Math.random() * AVATARS.length)]!.id;
}
/** Whether this device has picked before, so a signed-in player is only asked once. */
export function hasSavedAvatar(): boolean {
  try {
    return !!avatarById(localStorage.getItem(STORE));
  } catch {
    return false;
  }
}

export function saveAvatar(id: AvatarId): void {
  try {
    localStorage.setItem(STORE, id);
  } catch {
    /* not remembered, still used for this join */
  }
}
