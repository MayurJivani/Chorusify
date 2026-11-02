import { useEffect, type RefObject } from 'react';
import { useMotionValue, type MotionValue } from 'motion/react';

/**
 * How far `target` has travelled through the page's scroller, 0 to 1. The app scrolls inside
 * <main>, not the window. `from` and `to` are the viewport fractions where the target's top starts
 * and its bottom finishes.
 */
export function useSectionProgress(
  target: RefObject<HTMLElement | null>,
  from: number,
  to: number,
): MotionValue<number> {
  const progress = useMotionValue(0);
  useEffect(() => {
    const element = target.current;
    const scroller = element?.closest('main');
    if (!element || !scroller) return;
    const update = () => {
      const box = element.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      const start = view.top + view.height * from;
      const end = view.top + view.height * to;
      const travel = box.height + start - end;
      progress.set(Math.min(1, Math.max(0, (start - box.top) / travel)));
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      scroller.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [target, from, to, progress]);
  return progress;
}
