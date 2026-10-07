'use client';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, cx } from '@/components/ui';
import { StarRating } from '@/components/kit/StarRating';

type Ask = { subject: 'mock' | 'module' | 'overall'; ref: string; title: string; at: string };

/** Student portal: one optional rating at a time (finished mock, this week's classes, whole course). Each item is asked once. */
export function FeedbackAsk({ onAlert }: { onAlert?: () => void }) {
  const [asks, setAsks] = useState<Ask[] | null>(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabase().rpc('portal_feedback_pending');
    setAsks(Array.isArray(data) ? (data as Ask[]) : []);
    onAlert?.();
  }, [onAlert]);
  useEffect(() => { load(); }, [load]);

  const cur = asks?.[0];
  const send = async () => {
    if (!cur || !stars || busy) return;
    setBusy(true); setErr(null);
    const { error } = await supabase().rpc('portal_feedback_submit', { p_subject: cur.subject, p_ref: cur.ref, p_rating: stars, p_comment: comment.trim() || null, p_anonymous: hidden });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setThanks(true); setStars(0); setComment(''); setHidden(true);
    setAsks((a) => (a || []).slice(1));
    onAlert?.();
  };

  if (thanks && !cur) return (
    <section aria-label="Rate your training" className="flex items-center gap-2 border-t border-line pt-3 text-[13.5px] text-goodText" data-testid="feedback-thanks">
      <CheckCircle2 size={18} /> Thank you. Your rating helps us improve the classes.
    </section>
  );
  if (!cur) return null;
  return (
    <section aria-label="Rate your training" className="border-t border-line pt-3" data-testid="feedback-ask">
      {thanks && <p className="mb-2 flex items-center gap-1.5 text-[12.5px] text-goodText"><CheckCircle2 size={15} /> Thanks, saved.</p>}
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-semibold">{cur.title}</h2>
        <span className="shrink-0 text-[12px] text-muted">Optional{asks!.length > 1 ? ` · 1 of ${asks!.length}` : ''}</span>
      </div>
      <form className="mt-1 flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <StarRating label={cur.title} value={stars} onChange={setStars} disabled={busy} />
        {stars > 0 && <>
          <label className="flex flex-col gap-1 text-[12.5px] text-text2">
            What went well, or what should change? (optional)
            <textarea value={comment} maxLength={1000} rows={3} onChange={(e) => setComment(e.target.value)} className="rounded-[10px] border border-line2 bg-surface px-3 py-2 text-[14px] text-text" />
            <span className={cx('self-end text-[11.5px]', comment.length > 900 ? 'text-badText' : 'text-muted')}>{comment.length}/1000</span>
          </label>
          <label className="flex min-h-[44px] items-center gap-2.5 text-[13.5px]">
            <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} className="h-5 w-5 accent-[#4474B9]" />
            Keep my name hidden from the trainer
          </label>
        </>}
        {err && <p role="alert" className="text-[13px] text-badText">{err}</p>}
        <div><Button type="submit" variant="primary" size="sm" disabled={!stars || busy}>{busy ? 'Sending…' : 'Send rating'}</Button></div>
      </form>
    </section>
  );
}
