'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Search, UserPlus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PhoneInput, digits10, phoneProblem } from '../PhoneInput';
import { cx } from '../ui';

// Who referred this enquiry: search students, alumni, earlier referrers, staff and past enquiries (referrer_search);
// if nobody matches, add a new referrer with name, mobile and city (referrer_add, which reuses a match on the same mobile).
export type Referrer = { kind: 'candidate' | 'lead' | 'staff' | 'referrer'; id: string; name: string; detail?: string | null };
type Hit = Referrer & { mobile_last4?: string | null };

const ctl = 'h-11 w-full px-3 text-sm aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-badText';

export function ReferrerPicker({ value, onChange, required, error }: {
  value: Referrer | null; onChange: (r: Referrer | null) => void; required?: boolean; error?: string;
}) {
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searchFailed, setSearchFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  const [nw, setNw] = useState({ name: '', mobile: '', city: '' });
  const [addErr, setAddErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const seq = useRef(0);
  const listId = useId();
  const errId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = term.trim();
    const n = ++seq.current; // any answer to an older search is ignored
    if (t.length < 2) { setHits(null); setSearchFailed(false); return; }
    const timer = setTimeout(async () => {
      const { data, error: e } = await supabase().rpc('referrer_search', { p_term: t });
      if (n !== seq.current) return;
      setSearchFailed(!!e); setHits(e ? [] : (data as Hit[]) || []); setActive(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [term]);

  const pick = (h: Hit) => { onChange({ kind: h.kind, id: h.id, name: h.name, detail: h.detail }); setTerm(''); setHits(null); setNote(''); };
  const startAdd = () => {
    const t = term.trim();
    setNw({ name: /\d/.test(t) ? '' : t, mobile: /^\D*\d[\d\s+-]*$/.test(t) ? digits10(t) : '', city: '' });
    setAddErr(''); setAdding(true);
  };
  const saveNew = async () => {
    if (busy) return;
    const m = digits10(nw.mobile);
    const problem = !nw.name.trim() ? 'Enter the referrer’s name.' : m.length !== 10 || phoneProblem(m) ? 'Use a 10-digit mobile starting with 6–9.' : !nw.city.trim() ? 'Enter their city or area.' : '';
    if (problem) { setAddErr(problem); return; }
    setBusy(true); setAddErr('');
    const { data, error: e } = await supabase().rpc('referrer_add', { p_name: nw.name.trim(), p_mobile: m, p_city: nw.city.trim() });
    setBusy(false);
    if (e) { setAddErr(e.message.replace(/^.*?:\s*/, '') || 'Could not save the referrer. Please try again.'); return; }
    const r = data as { kind: Referrer['kind']; id: string; name: string; existing: boolean };
    onChange({ kind: r.kind, id: r.id, name: r.name, detail: r.existing ? 'Already in the CRM' : 'New referrer · ' + nw.city.trim() });
    setNote(r.existing ? `That mobile is already in the CRM as ${r.name}, so they are linked instead of added again.` : '');
    setAdding(false); setTerm(''); setHits(null);
  };

  if (value) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex min-h-[44px] items-center gap-2 rounded-[10px] border border-line2 bg-surface px-3 py-1.5" data-testid="referrer-picked">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-text">{value.name}</div>
            {value.detail && <div className="truncate text-[12px] text-muted">{value.detail}</div>}
          </div>
          <button type="button" onClick={() => { onChange(null); setNote(''); requestAnimationFrame(() => inputRef.current?.focus()); }}
            className="h-11 shrink-0 rounded-[8px] px-2 text-[13px] font-medium text-accentText hover:bg-surface2 md:h-9">Change</button>
        </div>
        {note && <span className="text-[12px] text-text2" role="status">{note}</span>}
      </div>
    );
  }

  if (adding) {
    return (
      // Enter here saves the referrer, not the whole enquiry
      <div className="flex flex-col gap-2 rounded-[10px] border border-line2 bg-surface2 p-3" data-testid="referrer-new"
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); e.stopPropagation(); saveNew(); } }}>
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-text">New referrer</span>
          <button type="button" onClick={() => setAdding(false)} aria-label="Cancel adding a referrer" className="flex h-11 w-11 items-center justify-center rounded-[8px] text-muted hover:bg-surface md:h-9 md:w-9"><X size={16} /></button>
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium text-text2">Their name <input className={ctl} value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} autoFocus autoComplete="off" /></label>
        <div className="flex flex-col gap-1 text-xs font-medium text-text2">Their mobile <PhoneInput label="Referrer mobile" value={nw.mobile} onChange={(m) => setNw({ ...nw, mobile: m })} /></div>
        <label className="flex flex-col gap-1 text-xs font-medium text-text2">City or area <input className={ctl} value={nw.city} onChange={(e) => setNw({ ...nw, city: e.target.value })} placeholder="e.g. Ameerpet, Hyderabad" /></label>
        {addErr && <span className="text-[12px] font-medium text-badText" role="alert">{addErr}</span>}
        <div className="flex gap-2">
          <button type="button" onClick={saveNew} disabled={busy} className="h-11 rounded-[10px] bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60 md:h-9">{busy ? 'Saving…' : 'Save referrer'}</button>
          <button type="button" onClick={() => setAdding(false)} className="h-11 rounded-[10px] px-3 text-sm font-medium text-text2 hover:bg-surface md:h-9">Cancel</button>
        </div>
      </div>
    );
  }

  const open = hits !== null;
  return (
    <div className="relative flex flex-col gap-1">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <input ref={inputRef} className={cx(ctl, 'pl-9')} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search name, student code or mobile"
          role="combobox" aria-label="Referred by" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-required={required || undefined}
          aria-activedescendant={open && hits.length ? `${listId}-${active}` : undefined}
          aria-invalid={!!error || undefined} aria-describedby={error ? errId : undefined} autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.stopPropagation(); // never submits the enquiry from the search box
            if (!hits?.length) { if (e.key === 'Enter') e.preventDefault(); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); pick(hits[active]); }
            else if (e.key === 'Escape') setHits(null);
          }} />
      </div>
      {open && (
        <div className="flex flex-col overflow-hidden rounded-[10px] border border-line2 bg-surface shadow-1">
          <ul id={listId} role="listbox" aria-label="People who could have referred them" className="max-h-64 overflow-y-auto">
            {hits.map((h, i) => (
              // options are picked with the arrow keys + Enter from the search box, or by click/tap (not separate Tab stops)
              <li key={h.kind + h.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)}
                className={cx('flex min-h-[44px] w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left', i === active && 'bg-surface2')}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text">{h.name}</span>
                    <span className="block truncate text-[12px] text-muted">{h.detail}</span>
                  </span>
                  {h.mobile_last4 && <span className="num shrink-0 text-[12px] text-muted">{h.mobile_last4}</span>}
              </li>
            ))}
          </ul>
          {searchFailed ? <p className="px-3 pt-2 text-[13px] text-badText" role="alert">Could not search right now. Please type again in a moment.</p>
            : !hits.length && <p className="px-3 pt-2 text-[13px] text-text2">Nobody in the CRM matches “{term.trim()}”. A mobile needs all 10 digits.</p>}
          <button type="button" onClick={startAdd} className="flex min-h-[44px] items-center gap-2 border-t border-line px-3 text-left text-[13px] font-semibold text-accentText hover:bg-surface2">
            <UserPlus size={15} aria-hidden /> Not in the list? Add new referrer
          </button>
        </div>
      )}
      {error && <span id={errId} className="text-[12px] font-medium text-badText">{error}</span>}
    </div>
  );
}
