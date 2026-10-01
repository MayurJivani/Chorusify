import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

/** Shared chrome for Privacy/Terms/Cookie pages: a title, a last-updated date, and a plain prose
 *  column. Legal text reads as a document, not a dashboard - no glass-card-per-section here,
 *  since breaking numbered sections into separate boxes makes a contract harder to read top to
 *  bottom, not easier. */
export function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 px-4 py-4 sm:py-8">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-extrabold text-white sm:text-4xl">{title}</h1>
        <p className="mt-2 text-xs text-slate-500">Last updated {lastUpdated}</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="glass flex flex-col gap-6 rounded-2xl p-6 text-sm leading-relaxed text-slate-300 sm:p-8 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-white [&_h3]:font-semibold [&_h3]:text-slate-100 [&_a]:font-medium [&_a]:text-chorusify-accent2 [&_a]:hover:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1"
      >
        {children}
      </motion.div>
    </div>
  );
}
