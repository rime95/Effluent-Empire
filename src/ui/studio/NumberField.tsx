import { useEffect, useState } from 'react';

/**
 * Number input that never fights the user: free typing in local text state, validated hint while typing,
 * committed (and clamped) only on blur, Enter or the spinner arrows.
 */
export function NumberField(props: { value: number; min?: number; max?: number; step?: number; disabled?: boolean; onCommit: (v: number) => void }) {
  const { value, min, max, step, disabled, onCommit } = props;
  const [text, setText] = useState(fmtNum(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmtNum(value));
  }, [value, focused]);

  const parsed = Number(text.replace(',', '.'));
  const valid = text.trim() !== '' && Number.isFinite(parsed);
  const outOfRange = valid && ((min !== undefined && parsed < min) || (max !== undefined && parsed > max));

  const commit = (raw = text) => {
    const v = Number(raw.replace(',', '.'));
    if (raw.trim() === '' || !Number.isFinite(v)) {
      setText(fmtNum(value));
      return;
    }
    const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    setText(fmtNum(c));
    if (c !== value) onCommit(c);
  };

  return (
    <div className="numfield">
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={text}
        className={outOfRange || (!valid && text !== '') ? 'invalid' : ''}
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setText(fmtNum(value));
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = valid ? parsed : value;
            const next = base + (e.key === 'ArrowUp' ? 1 : -1) * (step ?? 1) * (e.shiftKey ? 10 : 1);
            const v = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Number(next.toFixed(6))));
            setText(fmtNum(v));
            onCommit(v);
          }
        }}
      />
      {focused && outOfRange && (
        <span className="numfield-hint">
          {min !== undefined && parsed < min ? `min ${min}` : `max ${max}`} — will be limited on Enter
        </span>
      )}
    </div>
  );
}

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '';
  return String(Number(v.toPrecision(8)));
}
