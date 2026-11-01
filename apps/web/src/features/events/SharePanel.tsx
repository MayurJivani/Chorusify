import { memo, useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { QRCodeCanvas } from 'qrcode.react';

interface SharePanelProps {
  code: string;
  eventName?: string;
  needsPassword?: boolean;
  /** Bigger code for a screen the room reads from across the hall. */
  large?: boolean;
}

/**
 * The join code, as a QR, a link and something to download. Memoised because the screens it sits
 * on tick every second, and the QR is the one thing there that is costly to redraw. The link never
 * carries an event's password: anyone who photographs the screen gets the link, not the door code.
 */
export const SharePanel = memo(function SharePanel({
  code,
  eventName,
  needsPassword,
  large,
}: SharePanelProps) {
  const url = `${window.location.origin}/room/${code}`;
  const holder = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable; the link is on screen to copy by hand */
    }
  }, [url]);

  const download = useCallback(() => {
    const canvas = holder.current?.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${(eventName ?? 'chorusify').replace(/[^\w-]+/g, '-').toLowerCase()}-${code}-qr.png`;
    link.click();
  }, [code, eventName]);

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <motion.div
        ref={holder}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-2xl bg-white p-3 shadow-lg shadow-black/30"
      >
        <QRCodeCanvas
          value={url}
          size={large ? 720 : 480}
          level="M"
          marginSize={2}
          title={`QR code to join with code ${code}`}
          style={{ width: large ? 240 : 168, height: large ? 240 : 168 }}
        />
      </motion.div>
      <p
        className={`font-mono font-black tracking-[0.25em] text-chorusify-accent2 ${large ? 'text-4xl' : 'text-2xl'}`}
      >
        {code}
      </p>
      <p className="break-all text-xs text-slate-400">{url}</p>
      {needsPassword && (
        <p className="text-xs text-slate-300">Players also need the password you set.</p>
      )}
      <div className="flex w-full gap-2">
        <button type="button" onClick={copy} className="btn-primary flex-1 !rounded-xl !px-3 !py-2 !text-sm">
          {copied ? 'Copied' : 'Copy invite link'}
        </button>
        <button type="button" onClick={download} className="btn-secondary flex-1 !rounded-xl !px-3 !py-2 !text-sm">
          Download QR
        </button>
      </div>
    </div>
  );
});
