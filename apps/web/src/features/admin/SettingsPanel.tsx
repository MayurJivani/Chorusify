import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAdminSettings, resetAdminSetting, saveAdminSettings } from '../../api/admin';
import type { SettingDescriptor, SettingGroup } from '../../types/api';

const GROUP_LABELS: Record<SettingGroup, { title: string; blurb: string }> = {
  challenge: {
    title: 'Artist & Category runs',
    blurb: 'Applies to both modes, which play by the same rules.',
  },
  multiplayer: { title: 'Multiplayer', blurb: 'Rooms snapshot these when they are created.' },
  daily: { title: 'Daily challenge', blurb: 'How the shared song of the day is chosen.' },
  housekeeping: {
    title: 'Caching & cleanup',
    blurb: 'Trades database size against how often Deezer gets called.',
  },
};

const GROUP_ORDER: SettingGroup[] = ['challenge', 'multiplayer', 'daily', 'housekeeping'];

/** A value being edited, before it is validated by the server. Kept as the raw control state so
 *  a half-typed number doesn't get coerced to something the admin didn't type. */
type Draft = Record<string, unknown>;

export function SettingsPanel() {
  const [settings, setSettings] = useState<SettingDescriptor[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = useCallback((next: SettingDescriptor[]) => {
    setSettings(next);
    setDraft(Object.fromEntries(next.map((s) => [s.key, s.value])));
  }, []);

  useEffect(() => {
    getAdminSettings()
      .then(apply)
      .catch(() => setError('Couldn’t load the settings.'))
      .finally(() => setLoading(false));
  }, [apply]);

  const changed = useMemo(
    () => settings.filter((s) => JSON.stringify(draft[s.key]) !== JSON.stringify(s.value)),
    [settings, draft],
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      apply(await saveAdminSettings(changed.map((s) => ({ key: s.key, value: draft[s.key] }))));
      setNotice(`Saved ${changed.length} ${changed.length === 1 ? 'setting' : 'settings'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t save.');
    } finally {
      setSaving(false);
    }
  };

  const reset = async (key: string) => {
    setError(null);
    setNotice(null);
    try {
      apply(await resetAdminSetting(key));
      setNotice('Reset to the default.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t reset that.');
    }
  };

  if (loading) return <p className="text-sm text-slate-400">Loading settings…</p>;

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {notice}
        </p>
      )}

      {GROUP_ORDER.map((group) => {
        // The home albums have their own tab: a list of raw song ids means nothing here.
        const items = settings.filter((s) => s.group === group && s.key !== 'homeWallSongIds');
        if (items.length === 0) return null;
        return (
          <section key={group} className="flex flex-col gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
                {GROUP_LABELS[group].title}
              </h3>
              <p className="text-xs text-slate-500">{GROUP_LABELS[group].blurb}</p>
            </div>

            <div className="flex flex-col gap-2">
              {items.map((setting) => (
                <SettingRow
                  key={setting.key}
                  setting={setting}
                  value={draft[setting.key]}
                  onChange={(value) => setDraft((d) => ({ ...d, [setting.key]: value }))}
                  onReset={() => void reset(setting.key)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* Pinned so the save button is reachable however far down the list an edit was made. */}
      {changed.length > 0 && (
        <div className="glass sticky bottom-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 p-3">
          <p className="text-sm text-slate-300">
            {changed.length} unsaved {changed.length === 1 ? 'change' : 'changes'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => apply(settings)}
              className="btn-ghost !py-2 text-sm"
              disabled={saving}
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => void save()}
              className="btn-primary !py-2 text-sm"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingRow({
  setting,
  value,
  onChange,
  onReset,
}: {
  setting: SettingDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
  onReset: () => void;
}) {
  const { control } = setting;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">
            {setting.label}
            {!setting.isDefault && (
              <span className="ml-2 rounded-full bg-chorusify-accent/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-chorusify-accent">
                changed
              </span>
            )}
          </p>
          <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-slate-500">
            {setting.help}
          </p>
        </div>

        {!setting.isDefault && (
          <button
            type="button"
            onClick={onReset}
            className="shrink-0 text-xs text-slate-500 underline decoration-dotted hover:text-slate-300"
          >
            Reset to {JSON.stringify(setting.default)}
          </button>
        )}
      </div>

      {control.kind === 'boolean' && (
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 accent-purple-500"
          />
          {value === true ? 'On' : 'Off'}
        </label>
      )}

      {control.kind === 'number' && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={control.min}
            max={control.max}
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            className="w-28 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-sm text-white"
          />
          {control.unit && <span className="text-xs text-slate-500">{control.unit}</span>}
          <span className="text-xs text-slate-600">
            {control.min}–{control.max}
          </span>
        </div>
      )}

      {control.kind === 'numberList' && (
        <NumberListControl
          value={Array.isArray(value) ? (value as number[]) : []}
          control={control}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function NumberListControl({
  value,
  control,
  onChange,
}: {
  value: number[];
  control: { minLength: number; maxLength: number; min: number; max: number; unit?: string };
  onChange: (value: number[]) => void;
}) {
  const setAt = (index: number, next: number) =>
    onChange(value.map((v, i) => (i === index ? next : v)));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {value.map((seconds, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="font-mono text-[10px] text-slate-600">{i + 1}</span>
            <input
              type="number"
              min={control.min}
              max={control.max}
              value={seconds}
              onChange={(e) => setAt(i, Number(e.target.value))}
              className="w-16 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-center font-mono text-sm text-white"
            />
          </div>
        ))}
        {control.unit && <span className="text-xs text-slate-500">{control.unit}</span>}
      </div>

      <div className="flex items-center gap-2">
        {/* Also disabled once the last stage is already at the maximum: the only value a new
            stage could take would repeat it, and the server requires each stage to reveal more
            audio than the one before. */}
        <button
          type="button"
          disabled={
            value.length >= control.maxLength || (value[value.length - 1] ?? 0) >= control.max
          }
          onClick={() =>
            onChange([...value, Math.min(control.max, (value[value.length - 1] ?? 1) + 5)])
          }
          className="btn-ghost !py-1 text-xs disabled:opacity-40"
        >
          Add stage
        </button>
        <button
          type="button"
          disabled={value.length <= control.minLength}
          onClick={() => onChange(value.slice(0, -1))}
          className="btn-ghost !py-1 text-xs disabled:opacity-40"
        >
          Remove last
        </button>
        <span className="text-xs text-slate-600">
          {value.length} {value.length === 1 ? 'guess' : 'guesses'} per song
        </span>
      </div>
    </div>
  );
}
