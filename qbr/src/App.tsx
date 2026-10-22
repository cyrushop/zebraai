import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { slides } from './slides';
import { Footer } from './components/ui';

// Embedded viewers (e.g. a hosted link) cannot open the print dialog.
const canPrint = window.self === window.top;

const W = 1920;
const H = 1080;

function SlideFrame({ index }: { index: number }) {
  const s = slides[index];
  return (
    <div className="frame" data-slide={s.id}>
      {s.render()}
      {!s.cover && <Footer page={index + 1} />}
    </div>
  );
}

const fromHash = () => {
  const n = parseInt(location.hash.replace(/^#\/?/, ''), 10);
  return Number.isFinite(n) ? Math.min(Math.max(n - 1, 0), slides.length - 1) : 0;
};

export default function App() {
  const [i, setI] = useState(fromHash);
  const [scale, setScale] = useState(1);
  const [notes, setNotes] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);

  const go = useCallback((n: number) => setI(Math.min(Math.max(n, 0), slides.length - 1)), []);

  useEffect(() => {
    history.replaceState(null, '', `#${i + 1}`);
  }, [i]);

  useLayoutEffect(() => {
    const fit = () => {
      const el = viewport.current;
      if (el) setScale(Math.min(el.clientWidth / W, el.clientHeight / H));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (viewport.current) ro.observe(viewport.current);
    return () => ro.disconnect();
  }, []);

  const fullscreen = () =>
    (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': case ' ': e.preventDefault(); go(i + 1); break;
        case 'ArrowLeft': case 'PageUp': e.preventDefault(); go(i - 1); break;
        case 'Home': go(0); break;
        case 'End': go(slides.length - 1); break;
        case 'f': case 'F': fullscreen(); break;
        case 'n': case 'N': setNotes((v) => !v); break;
        case 'p': case 'P': if (canPrint) window.print(); break;
      }
    };
    const onHash = () => setI(fromHash());
    window.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHash);
    };
  }, [i, go]);

  const note = slides[i].notes;

  return (
    <>
      <div className="app">
        <div className="viewport" ref={viewport}>
          <div className="stage" style={{ width: W * scale, height: H * scale }}>
            <div className="canvas" style={{ transform: `scale(${scale})` }}>
              <SlideFrame index={i} />
            </div>
          </div>
        </div>
        {notes && (
          <div className="notes">
            <strong>Speaker notes · {slides[i].title}</strong>
            <span>{note ?? 'No notes for this slide.'}</span>
          </div>
        )}
        <nav className="controls" aria-label="Slide controls">
          <button onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous slide">‹</button>
          <select value={i} onChange={(e) => go(+e.target.value)} aria-label="Go to slide">
            {slides.map((s, n) => <option key={s.id} value={n}>{n + 1}. {s.title}</option>)}
          </select>
          <span className="counter">{i + 1} / {slides.length}</span>
          <button onClick={() => go(i + 1)} disabled={i === slides.length - 1} aria-label="Next slide">›</button>
          <span className="sep" />
          <button onClick={() => setNotes((v) => !v)} className={notes ? 'on' : ''} title="Speaker notes (N)">Notes</button>
          {canPrint && <button onClick={() => window.print()} title="Print / export to PDF (P)">PDF</button>}
          <button onClick={fullscreen} title="Full screen (F)">⛶</button>
        </nav>
      </div>
      {/* One slide per page when printing / saving as PDF. */}
      <div className="print-deck">
        {slides.map((s, n) => <SlideFrame key={s.id} index={n} />)}
      </div>
    </>
  );
}
