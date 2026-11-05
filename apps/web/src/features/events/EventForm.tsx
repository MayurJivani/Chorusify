import { useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { saveEvent } from '../../api/events';
import type { EventAudioMode, EventInput, HostedEvent, Playlist } from '../../types/api';

const AUDIO_MODES: { value: EventAudioMode; title: string; body: string }[] = [
  {
    value: 'everyone_plays',
    title: 'Everyone plays',
    body: 'Every phone plays the song together. For rooms without a sound system.',
  },
  {
    value: 'host_only',
    title: 'Host only',
    body: 'Only your device plays it, through the venue speakers. Phones just answer.',
  },
];

export function EventForm({
  playlists,
  event,
  onSaved,
  onCancel,
}: {
  playlists: Playlist[];
  event: HostedEvent | null;
  onSaved: (event: HostedEvent) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Omit<EventInput, 'password'>>({
    name: event?.name ?? '',
    description: event?.description ?? '',
    visibility: event?.visibility ?? 'unlisted',
    audioMode: event?.audioMode ?? 'everyone_plays',
    hostPlays: event?.hostPlays ?? false,
    rounds: event?.rounds ?? 10,
    playbackSeconds: event?.playbackSeconds ?? 15,
    guessSeconds: event?.guessSeconds ?? 20,
    maxPoints: event?.maxPoints ?? 1000,
    minPoints: event?.minPoints ?? 200,
    firstBonus: event?.firstBonus ?? 100,
    playlistId: event?.playlistId ?? playlists[0]?.id ?? '',
    showCovers: event?.showCovers ?? false,
  });
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const chosen = playlists.find((p) => p.id === form.playlistId);
  const songCount = chosen?.tracks.length ?? 0;
  const trialTitle = chosen?.trialTrack?.title;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input: EventInput = {
        ...form,
        // Blank keeps what is stored on an edit; only an explicit removal clears it.
        ...(password ? { password } : clearPassword ? { password: null } : {}),
      };
      const { event: saved } = await saveEvent(event?.id ?? null, input);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the event.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Field label="Event name">
        <input
          required
          maxLength={80}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Freshers' music quiz"
          className="event-input"
        />
      </Field>
      <Field label="Description" hint="Shown on the join page.">
        <textarea
          maxLength={500}
          rows={2}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          className="event-input"
        />
      </Field>
      <Field label="Playlist">
        <select
          required
          value={form.playlistId}
          onChange={(e) => set('playlistId', e.target.value)}
          className="event-input"
        >
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.tracks.length} songs)
            </option>
          ))}
        </select>
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium text-slate-300">Where the music plays</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {AUDIO_MODES.map((mode) => {
            const on = form.audioMode === mode.value;
            return (
              <label
                key={mode.value}
                className={`relative cursor-pointer rounded-xl border p-3 transition-colors ${
                  on ? 'border-white/40' : 'border-white/10 hover:border-white/25'
                }`}
              >
                {on && (
                  <motion.span
                    layoutId="audio-mode"
                    transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                    className="absolute inset-0 rounded-xl bg-white/[0.07]"
                  />
                )}
                <input
                  type="radio"
                  name="audioMode"
                  className="sr-only"
                  checked={on}
                  onChange={() => set('audioMode', mode.value)}
                />
                <span className="relative block text-sm font-semibold text-white">
                  {mode.title}
                </span>
                <span className="relative mt-0.5 block text-xs text-slate-400">{mode.body}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className="flex items-center gap-2.5 text-sm text-slate-200">
        <input
          type="checkbox"
          checked={form.hostPlays}
          onChange={(e) => set('hostPlays', e.target.checked)}
          className="h-4 w-4 accent-white"
        />
        I am playing too (puts me on the leaderboard)
      </label>

      <label className="flex items-center gap-2.5 text-sm text-slate-200">
        <input
          type="checkbox"
          checked={form.showCovers}
          onChange={(e) => set('showCovers', e.target.checked)}
          className="h-4 w-4 accent-white"
        />
        Show album covers on the answers
      </label>

      {trialTitle && (
        <p className="text-sm text-slate-300">
          Trial song: <span className="font-semibold text-white">{trialTitle}</span>
          <span className="text-slate-400">
            {' '}
            (from the playlist, plays first and does not count)
          </span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <NumberField
          label="Rounds"
          hint={`Needs ${(form.rounds || 1) + 3} songs, playlist has ${songCount}`}
          value={form.rounds}
          min={1}
          max={Math.max(1, songCount - 3)}
          onChange={(v) => set('rounds', v)}
        />
        <NumberField
          label="Song plays for"
          unit="s"
          value={form.playbackSeconds}
          min={3}
          max={30}
          onChange={(v) => set('playbackSeconds', v)}
        />
        <NumberField
          label="Time to answer"
          unit="s"
          value={form.guessSeconds}
          min={5}
          max={120}
          onChange={(v) => set('guessSeconds', v)}
        />
        <NumberField
          label="Instant answer"
          unit="pts"
          value={form.maxPoints}
          min={1}
          max={10000}
          onChange={(v) => set('maxPoints', v)}
        />
        <NumberField
          label="Last-second answer"
          unit="pts"
          value={form.minPoints}
          min={0}
          max={10000}
          onChange={(v) => set('minPoints', v)}
        />
        <NumberField
          label="First correct bonus"
          unit="pts"
          value={form.firstBonus}
          min={0}
          max={10000}
          onChange={(v) => set('firstBonus', v)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Who can find it">
          <select
            value={form.visibility}
            onChange={(e) => set('visibility', e.target.value as EventInput['visibility'])}
            className="event-input"
          >
            <option value="unlisted">Only people with the link</option>
            <option value="public">Listed on the multiplayer page</option>
          </select>
        </Field>
        <Field
          label="Password (optional)"
          hint={
            event?.hasPassword
              ? 'Set. Leave blank to keep it.'
              : 'Never included in the QR code or link.'
          }
        >
          <input
            type="text"
            autoComplete="off"
            maxLength={100}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="event-input"
          />
        </Field>
      </div>
      {event?.hasPassword && (
        <label className="flex items-center gap-2.5 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={clearPassword}
            onChange={(e) => setClearPassword(e.target.checked)}
            className="h-4 w-4 accent-white"
          />
          Remove the password
        </label>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost flex-1 !rounded-xl">
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !form.playlistId || songCount < 4}
          className="btn-primary flex-1 !rounded-xl"
        >
          {saving ? 'Saving…' : event ? 'Save changes' : 'Create event'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-300">
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-slate-400">{hint}</span>}
    </label>
  );
}

function NumberField({
  label,
  hint,
  unit,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={unit ? `${label} (${unit})` : label} hint={hint}>
      <input
        type="number"
        inputMode="numeric"
        required
        min={min}
        max={max}
        value={Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        className="event-input tabular-nums"
      />
    </Field>
  );
}
