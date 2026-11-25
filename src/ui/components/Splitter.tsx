import { useRef } from 'react';

/**
 * Drag handle between two panels. Reports the new size as the pointer moves: `dir` is the axis, `sign` +1 when moving
 * right/down grows the panel (left palette, top), −1 when it shrinks it (right inspector, bottom drawer).
 * Double-click resets.
 */
export function Splitter({
  dir,
  sign,
  size,
  onSize,
  onReset,
  className = '',
}: {
  dir: 'x' | 'y';
  sign: 1 | -1;
  size: number;
  onSize: (px: number) => void;
  onReset?: () => void;
  className?: string;
}) {
  const start = useRef<{ p: number; size: number } | null>(null);
  return (
    <div
      className={`splitter splitter-${dir} ${className}`}
      role="separator"
      aria-orientation={dir === 'x' ? 'vertical' : 'horizontal'}
      title="Drag to resize · double-click to reset"
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { p: dir === 'x' ? e.clientX : e.clientY, size };
        document.body.classList.add(dir === 'x' ? 'resizing-x' : 'resizing-y');
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const d = (dir === 'x' ? e.clientX : e.clientY) - start.current.p;
        onSize(start.current.size + sign * d);
      }}
      onPointerUp={(e) => {
        start.current = null;
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        document.body.classList.remove('resizing-x', 'resizing-y');
      }}
    />
  );
}
