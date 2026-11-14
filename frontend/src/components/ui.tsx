import { useEffect, useRef, useState, type ReactNode } from 'react';
import { INSTRUMENT, type Opt } from '../lib/instrument';

export function Choices({ options, value, onChange, cols2, scale5 }: { options: Opt[]; value: any; onChange: (v: number) => void; cols2?: boolean; scale5?: boolean }) {
  const main = scale5 ? options.filter((o) => o.code > 0) : options;
  const extra = scale5 ? options.filter((o) => o.code <= 0) : [];
  return (
    <>
      <div className={scale5 ? 'scale5' : 'choices' + (cols2 ? ' cols2' : '')} role="radiogroup">
        {main.map((o) => (
          <button key={o.code} type="button" role="radio" aria-checked={value === o.code} className="choice" onClick={() => onChange(o.code)}>
            <span className="mark" />
            <span>{o.label}{o.hint && <span className="hint">{o.hint}</span>}</span>
          </button>
        ))}
      </div>
      {extra.map((o) => (
        <button key={o.code} type="button" role="radio" aria-checked={value === o.code} className="choice sep" onClick={() => onChange(o.code)}>
          <span className="mark" /><span>{o.label}</span>
        </button>
      ))}
    </>
  );
}

export function MultiChoices({ options, value, onChange, exclusive }: { options: Opt[]; value: number[]; onChange: (v: number[]) => void; exclusive?: number }) {
  const toggle = (code: number) => {
    const has = value.includes(code);
    let next = has ? value.filter((c) => c !== code) : [...value, code];
    if (exclusive !== undefined && !has) next = code === exclusive ? [code] : next.filter((c) => c !== exclusive);
    onChange(next);
  };
  return (
    <div className={'choices' + (options.length > 5 ? ' cols2' : '')}>
      {options.map((o) => (
        <button key={o.code} type="button" role="checkbox" aria-checked={value.includes(o.code)} className="choice multi" onClick={() => toggle(o.code)}>
          <span className="mark" />
          <span>{o.label}{o.hint && <span className="hint">{o.hint}</span>}</span>
        </button>
      ))}
    </div>
  );
}

export function Modal({ children, onClose, wide }: { children: ReactNode; onClose?: () => void; wide?: boolean }) {
  return (
    <div className="modal-bg" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

/** Pictograma ARASAAC servido desde la propia aplicación; si falta la imagen se muestra el texto. */
export function Picto({ id, alt }: { id: number; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="ph" role="img" aria-label={alt}>{alt}</div>;
  return <img src={`/pictos/${id}.png`} alt={alt} draggable={false} onError={() => setFailed(true)} />;
}
export const PICTO_CREDIT: string = INSTRUMENT.pictos.atribucion;

/** Campo de texto que guarda al salir o tras una pausa, para no escribir en disco con cada tecla. */
export function TextInput({ value, onCommit, placeholder, area, autoFocus, inputMode, id }: { value: string; onCommit: (v: string) => void; placeholder?: string; area?: boolean; autoFocus?: boolean; inputMode?: any; id?: string }) {
  const [v, setV] = useState(value ?? '');
  const last = useRef(value ?? '');
  const timer = useRef<any>(null);
  useEffect(() => { if (value !== last.current) { setV(value ?? ''); last.current = value ?? ''; } }, [value]);
  const commit = (x: string) => { clearTimeout(timer.current); if (x !== last.current) { last.current = x; onCommit(x); } };
  const change = (x: string) => { setV(x); clearTimeout(timer.current); timer.current = setTimeout(() => commit(x), 600); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const props = { id, className: 'field', value: v, placeholder, autoFocus, inputMode, onChange: (e: any) => change(e.target.value), onBlur: () => commit(v), autoComplete: 'off', autoCorrect: 'off', spellCheck: false } as any;
  return area ? <textarea {...props} /> : <input type="text" {...props} />;
}

export function SignaturePad({ value, onChange }: { value?: string; onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    c.width = r.width * 2; c.height = r.height * 2;
    const ctx = c.getContext('2d')!;
    ctx.scale(2, 2); ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#12211e';
    if (value) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, r.width, r.height); img.src = value; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <canvas ref={ref} className="sigpad" aria-label="Espacio para firmar"
        onPointerDown={(e) => { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); dirty.current = true; }}
        onPointerUp={() => { drawing.current = false; if (dirty.current) onChange(ref.current!.toDataURL('image/png')); }} />
      <div><button type="button" className="btn sm" onClick={() => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); dirty.current = false; onChange(null); }}>Borrar firma</button></div>
    </div>
  );
}

export function useStore<T>(subscribe: (fn: () => void) => () => void, get: () => T): T {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((n) => n + 1)), [subscribe]);
  return get();
}

export const fmtDate = (v: any) => (v ? new Date(v).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
