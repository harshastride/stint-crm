'use client';
import { plainMessage } from '@/lib/plainMessage';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowDown, ArrowLeft, Loader2, Mic, Square } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button, Notice, Pill, cx, fmtDuration } from '../ui';
import { PageHeader } from '../kit/PageHeader';
import { Confirm } from '../kit/Confirm';

// Live help: the telecaller calls a lead from their own phone on speaker; this page listens through the laptop mic,
// turns speech into text live (Deepgram, straight from the browser) and asks /api/live/tips for fresh tips each time
// someone finishes speaking. At the end it writes a call summary and hands it to the lead's "Log call" box.
// The audio is never stored. Nothing is saved on the server here except through the summary and the logged call.

type Seg = { speaker: string; text: string };
type Tips = { they_said: string; say_this: string; still_to_cover: string[]; ask_for: string; careful: string | null };
type Summary = { summary: string; outcome: string | null; follow_up: string | null; follow_up_when: string | null };
type Lead = { id: string; full_name: string; stage: string | null; program: { name: string } | { name: string }[] | null };
type Phase = 'idle' | 'starting' | 'live' | 'lost' | 'summarising' | 'done';
type DGWord = { speaker?: number };
type DGMessage = {
  type?: string; is_final?: boolean; speech_final?: boolean;
  channel?: { alternatives?: { transcript?: string; words?: DGWord[] }[] };
};

const TIPS_GAP_MS = 6000; // at least this long between two tips requests
const KEEPALIVE_MS = 8000;
const OPEN_TIMEOUT_MS = 10000;
const LAST_SEGMENTS = 40;

/** The speaker most of the words belong to (diarize), as "Speaker 1", "Speaker 2"… */
function speakerOf(words: DGWord[] | undefined, fallback: string): string {
  if (!words?.length) return fallback;
  const count = new Map<number, number>();
  for (const w of words) if (typeof w.speaker === 'number') count.set(w.speaker, (count.get(w.speaker) || 0) + 1);
  let best = -1, most = 0;
  count.forEach((n, sp) => { if (n > most) { most = n; best = sp; } });
  return best < 0 ? fallback : 'Speaker ' + (best + 1);
}

const shortError = (j: unknown, fallback: string) => {
  const e = (j as { error?: unknown } | null)?.error;
  return typeof e === 'string' && e.length < 200 ? plainMessage(e, fallback) : fallback;
};

function micProblem(e: unknown): string {
  const name = (e as { name?: string } | null)?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'The microphone is blocked. Click the lock or microphone icon at the left of the address bar, set Microphone to “Allow”, then tap Start again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No microphone was found. Check the laptop’s sound settings or plug one in, then tap Start again.';
  if (name === 'NotReadableError' || name === 'AbortError')
    return 'The microphone is busy in another app (for example Zoom or Teams). Close it there, then tap Start again.';
  return 'Could not use the microphone. Check that it is allowed for this site, then tap Start again.';
}

export function LiveHelp({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [leadState, setLeadState] = useState<'loading' | 'ok' | 'missing'>('loading');
  const [notSetUp, setNotSetUp] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [phase, setPhaseState] = useState<Phase>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [segments, setSegments] = useState<Seg[]>([]);
  const [interim, setInterim] = useState<Seg | null>(null);
  const [tips, setTips] = useState<Tips | null>(null);
  const [tipsLoading, setTipsLoading] = useState(false);
  const [tipsNote, setTipsNote] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const [secs, setSecs] = useState(0);
  const [result, setResult] = useState<Summary | null>(null);
  const [resultErr, setResultErr] = useState<string | null>(null);
  const [scrolledUp, setScrolledUp] = useState(false);

  // live connection
  const phaseRef = useRef<Phase>('idle');
  const ws = useRef<WebSocket | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const keepAlive = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioSent = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStart = useRef<number | null>(null);
  const duration = useRef(0);
  const alive = useRef(true);
  // transcript
  const segRef = useRef<Seg[]>([]);
  const interimRef = useRef<Seg | null>(null);
  const lastSpeaker = useRef('Speaker 1');
  const finalVer = useRef(0);
  // tips requests
  const tipsVer = useRef(0);
  const lastTipsAt = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef(false);
  const reqSeq = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  // transcript scrolling
  const listBox = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const go = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };

  // lead name, stage and course (the mobile number is never read here)
  useEffect(() => {
    let on = true;
    supabase().from('lead_list').select('id, full_name, stage, program:program_id(name)').eq('id', leadId).maybeSingle()
      .then(({ data, error }: { data: Lead | null; error: unknown }) => {
        if (!on) return;
        if (data && !error) { setLead(data); setLeadState('ok'); } else setLeadState('missing');
      }, () => { if (on) setLeadState('missing'); });
    return () => { on = false; };
  }, [leadId]);

  // is live help set up? (a 503 means no; then there is no Start button)
  useEffect(() => {
    let on = true;
    fetch('/api/live/token', { method: 'POST' }).then(async (res) => {
      if (!on || res.status !== 503) return;
      const j = await res.json().catch(() => ({}));
      if (on) setNotSetUp(shortError(j, 'Live help is not set up yet. Ask the admin to turn it on.'));
    }).catch(() => {});
    return () => { on = false; };
  }, []);

  // stop everything when leaving the page
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; reqSeq.current++;
      teardown(); stopTimer(); if (retry.current) clearTimeout(retry.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the browser asks before closing or reloading while a call is on or a summary is not logged yet
  const busy = phase !== 'idle';
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  // keep the newest words in view unless the telecaller scrolled up to read
  useEffect(() => {
    const el = listBox.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [segments, interim]);

  const onListScroll = () => {
    const el = listBox.current;
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stick.current = atEnd; setScrolledUp(!atEnd);
  };
  const jumpToNewest = () => {
    const el = listBox.current;
    if (el) el.scrollTop = el.scrollHeight;
    stick.current = true; setScrolledUp(false);
  };

  function stopTimer() { if (timer.current) { clearInterval(timer.current); timer.current = null; } }

  /** Close the mic and the socket at once, without waiting for the last words. */
  function teardown() {
    if (keepAlive.current) { clearInterval(keepAlive.current); keepAlive.current = null; }
    const r = rec.current; rec.current = null;
    if (r) { r.ondataavailable = null; r.onstop = null; r.onerror = null; if (r.state !== 'inactive') { try { r.stop(); } catch {} } }
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    const w = ws.current; ws.current = null;
    if (w) {
      w.onopen = null; w.onmessage = null; w.onerror = null; w.onclose = null;
      try { if (w.readyState === 1) w.send(JSON.stringify({ type: 'CloseStream' })); if (w.readyState <= 1) w.close(); } catch {}
    }
  }

  function addFinal(speaker: string, text: string) {
    const list = segRef.current;
    const last = list[list.length - 1];
    segRef.current = last && last.speaker === speaker ? [...list.slice(0, -1), { speaker, text: last.text + ' ' + text }] : [...list, { speaker, text }];
    lastSpeaker.current = speaker;
    finalVer.current++;
    setSegments(segRef.current);
  }

  function onMessage(ev: MessageEvent) {
    if (typeof ev.data !== 'string') return;
    let m: DGMessage;
    try { m = JSON.parse(ev.data) as DGMessage; } catch { return; }
    if (m.type === 'Results') {
      const alt = m.channel?.alternatives?.[0];
      const text = (alt?.transcript || '').trim();
      const speaker = speakerOf(alt?.words, lastSpeaker.current);
      if (m.is_final) {
        if (text) addFinal(speaker, text);
        interimRef.current = null; setInterim(null);
      } else {
        interimRef.current = text ? { speaker, text } : null; setInterim(interimRef.current);
      }
      if (m.speech_final) askForTips();
    } else if (m.type === 'UtteranceEnd') askForTips();
  }

  /** After someone finishes speaking: ask for fresh tips if there is new text, nothing in flight, and 6 s have passed. */
  function askForTips() {
    if (!alive.current || phaseRef.current !== 'live') return;
    if (inFlight.current) { pending.current = true; return; }
    if (finalVer.current === tipsVer.current) return;
    const wait = TIPS_GAP_MS - (Date.now() - lastTipsAt.current);
    if (wait > 0) {
      if (!retry.current) retry.current = setTimeout(() => { retry.current = null; askForTips(); }, wait);
      return;
    }
    void sendTips();
  }

  async function sendTips() {
    inFlight.current = true;
    const seq = ++reqSeq.current;
    tipsVer.current = finalVer.current; lastTipsAt.current = Date.now();
    setTipsLoading(true);
    try {
      const res = await fetch('/api/live/tips', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId, transcript: segRef.current.slice(-LAST_SEGMENTS) }),
      });
      const j = await res.json().catch(() => null);
      if (!alive.current || seq !== reqSeq.current) return; // a newer request was sent, or the call ended
      if (res.status === 429) return; // too often: skip this round
      if (res.ok && j && typeof j.say_this === 'string') {
        setTips({
          they_said: String(j.they_said || ''), say_this: j.say_this,
          still_to_cover: Array.isArray(j.still_to_cover) ? j.still_to_cover.filter((x: unknown): x is string => typeof x === 'string' && !!x.trim()) : [],
          ask_for: String(j.ask_for || ''), careful: typeof j.careful === 'string' && j.careful.trim() ? j.careful : null,
        });
        setTipsNote(null);
      } else {
        setTipsNote(shortError(j, 'Could not get new tips this time. They will try again after the next answer.'));
      }
    } catch {
      if (alive.current && seq === reqSeq.current) setTipsNote('Could not reach the server for tips. They will try again after the next answer.');
    } finally {
      if (seq === reqSeq.current) setTipsLoading(false);
      inFlight.current = false;
      if (pending.current) { pending.current = false; askForTips(); }
    }
  }

  async function start() {
    if (!consent || phaseRef.current === 'starting' || phaseRef.current === 'live') return;
    const back: Phase = callStart.current ? 'lost' : 'idle';
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined' || typeof WebSocket === 'undefined') {
      setErr('This browser can’t listen through the microphone here. Use Chrome or Edge on this laptop.'); return;
    }
    go('starting');
    // 1. the microphone (asked only now)
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      if (alive.current) { setErr(micProblem(e)); go(back); }
      return;
    }
    if (!alive.current) { mic.getTracks().forEach((t) => t.stop()); return; }
    stream.current = mic;
    // 2. a fresh 30-second key, right before opening
    let token = '', url = '';
    try {
      const res = await fetch('/api/live/token', { method: 'POST' });
      const j = await res.json().catch(() => null);
      if (res.status === 503) { const m = shortError(j, 'Live help is not set up yet. Ask the admin to turn it on.'); setNotSetUp(m); if (back === 'lost') setErr(m); teardown(); go(back); return; }
      if (!res.ok || typeof j?.token !== 'string' || typeof j?.url !== 'string') { setErr(shortError(j, 'Could not start live help. Please try again.')); teardown(); go(back); return; }
      token = j.token; url = j.url;
    } catch {
      setErr('Could not reach the server. Check the internet connection and try again.'); teardown(); go(back); return;
    }
    if (!alive.current) { teardown(); return; }
    // 3. the live connection, then the recorder
    let w: WebSocket;
    try { w = new WebSocket(url, ['bearer', token]); } catch { setErr('Could not connect to the listening service. Please try again.'); teardown(); go(back); return; }
    ws.current = w;
    let opened = false;
    const openTimer = setTimeout(() => { if (!opened && ws.current === w) { teardown(); setErr('The listening service did not answer. Check the internet connection and tap Start again.'); go(back); } }, OPEN_TIMEOUT_MS);
    w.onopen = () => {
      clearTimeout(openTimer);
      if (ws.current !== w || !stream.current) return;
      opened = true;
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
      let r: MediaRecorder;
      try { r = new MediaRecorder(stream.current, type ? { mimeType: type } : undefined); } catch { teardown(); setErr('This browser can’t send the microphone sound. Use Chrome or Edge.'); go(back); return; }
      r.ondataavailable = (e) => { if (e.data.size && w.readyState === 1) { w.send(e.data); audioSent.current = true; } };
      r.onerror = () => lose('The microphone stopped.');
      stream.current.getAudioTracks().forEach((t) => { t.onended = () => lose('The microphone was disconnected.'); });
      r.start(250);
      rec.current = r;
      audioSent.current = false;
      keepAlive.current = setInterval(() => {
        if (!audioSent.current && w.readyState === 1) { try { w.send(JSON.stringify({ type: 'KeepAlive' })); } catch {} }
        audioSent.current = false;
      }, KEEPALIVE_MS);
      if (!callStart.current) callStart.current = Date.now();
      stopTimer();
      setSecs(Math.round((Date.now() - callStart.current) / 1000));
      timer.current = setInterval(() => { if (callStart.current) setSecs(Math.round((Date.now() - callStart.current) / 1000)); }, 500);
      go('live');
    };
    w.onmessage = onMessage;
    w.onerror = () => {}; // onclose follows and explains
    w.onclose = () => {
      clearTimeout(openTimer);
      if (ws.current !== w) return;
      if (opened) lose();
      else { teardown(); setErr('Could not connect to the listening service. Please tap Start again.'); go(back); }
    };
  }

  /** The connection dropped mid-call: keep what was said and the tips; the timer keeps running (the phone call goes on). */
  function lose(why?: string) {
    if (phaseRef.current !== 'live') return;
    teardown();
    if (retry.current) { clearTimeout(retry.current); retry.current = null; }
    if (interimRef.current) { addFinal(interimRef.current.speaker, interimRef.current.text); interimRef.current = null; setInterim(null); }
    setErr(why ? why + ' Tap Start to continue.' : null);
    go('lost');
  }

  /** Stop: let the last words arrive (up to 2.5 s), close everything, then write the summary. */
  async function stop() {
    if (phaseRef.current !== 'live') return;
    go('summarising');
    reqSeq.current++; pending.current = false; setTipsLoading(false);
    if (retry.current) { clearTimeout(retry.current); retry.current = null; }
    const w = ws.current, r = rec.current;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(t); resolve(); } };
      const t = setTimeout(finish, 2500);
      if (w) { w.onclose = finish; w.onerror = null; } // onmessage stays on for the last results
      const closeStream = () => {
        stream.current?.getTracks().forEach((tr) => { tr.onended = null; tr.stop(); });
        try { if (w && w.readyState === 1) w.send(JSON.stringify({ type: 'CloseStream' })); else finish(); } catch { finish(); }
      };
      if (r && r.state !== 'inactive') { r.onerror = null; r.onstop = closeStream; try { r.stop(); } catch { closeStream(); } }
      else closeStream();
    });
    teardown();
    if (interimRef.current) { addFinal(interimRef.current.speaker, interimRef.current.text); interimRef.current = null; setInterim(null); }
    await summarise();
  }

  async function summarise() {
    go('summarising');
    stopTimer();
    setErr(null);
    const secsNow = callStart.current ? Math.max(1, Math.round((Date.now() - callStart.current) / 1000)) : 0;
    duration.current = secsNow; setSecs(secsNow);
    const transcript = segRef.current;
    if (!transcript.length) {
      setResult(null); setResultErr('Nothing was heard, so there is no summary. You can still log the call and write the notes yourself.');
      go('done'); return;
    }
    try {
      const res = await fetch('/api/live/summary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId, transcript, duration_sec: secsNow }),
      });
      const j = await res.json().catch(() => null);
      if (!alive.current) return;
      if (res.ok && j && typeof j.summary === 'string') {
        setResult({ summary: j.summary, outcome: j.outcome || null, follow_up: j.follow_up || null, follow_up_when: j.follow_up_when || null });
        setResultErr(null);
      } else {
        setResult(null);
        setResultErr(shortError(j, 'Could not write the summary.') + ' You can still log the call and write the notes yourself.');
      }
    } catch {
      if (!alive.current) return;
      setResult(null); setResultErr('Could not reach the server to write the summary. You can still log the call and write the notes yourself.');
    }
    go('done');
  }

  function logCall() {
    const r = result;
    const body = r ? r.summary + (r.follow_up ? '\nNext: ' + r.follow_up + (r.follow_up_when ? ' (' + r.follow_up_when + ')' : '') : '') : '';
    try { sessionStorage.setItem('stint-live-draft:' + leadId, JSON.stringify({ outcome: r?.outcome ?? null, body, duration: duration.current })); } catch {}
    go('idle'); // no "leave page?" prompt for this move
    router.push('/p/lead?person=lead:' + leadId);
  }

  function discard() {
    reqSeq.current++; teardown(); stopTimer();
    if (retry.current) { clearTimeout(retry.current); retry.current = null; }
    segRef.current = []; interimRef.current = null; finalVer.current = 0; tipsVer.current = 0; lastTipsAt.current = 0;
    inFlight.current = false; pending.current = false; callStart.current = null; duration.current = 0; lastSpeaker.current = 'Speaker 1';
    setSegments([]); setInterim(null); setTips(null); setTipsNote(null); setTipsLoading(false); setTicked(new Set());
    setResult(null); setResultErr(null); setErr(null); setSecs(0); setConsent(false);
    stick.current = true; setScrolledUp(false);
    go('idle');
  }

  const toggleTick = (item: string) => setTicked((prev) => { const n = new Set(prev); if (n.has(item)) n.delete(item); else n.add(item); return n; });

  const leadHref = '/p/lead?person=lead:' + leadId;
  const course = lead ? (Array.isArray(lead.program) ? lead.program[0]?.name : lead.program?.name) || null : null;
  const description = lead ? [lead.stage ? 'Stage: ' + lead.stage : null, course ? 'Course: ' + course : null].filter(Boolean).join(' · ') || 'Tips while you talk' : 'Tips while you talk';

  const backLink = (
    <Link href={leadHref}
      onClick={(e) => { if (phaseRef.current !== 'idle' && !window.confirm('Leave live help? What was said and the summary on this page will be lost.')) e.preventDefault(); }}
      className="btn inline-flex h-11 items-center gap-2 rounded-[10px] border border-line2 bg-surface px-4 text-[13.5px] font-medium text-text hover:bg-surface2">
      <ArrowLeft size={16} aria-hidden /> Back to lead
    </Link>
  );

  const onCall = phase === 'live' || phase === 'lost' || (phase === 'starting' && callStart.current !== null);

  return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <PageHeader group="Live help" title={lead?.full_name || (leadState === 'loading' ? 'Loading…' : 'Live help')} description={description} actions={backLink} />

      {leadState === 'missing' && <Notice tone="bad">This lead was not found, or your role can’t open it. Go back to Leads and pick the lead again.</Notice>}

      {leadState !== 'missing' && (phase === 'idle' || (phase === 'starting' && !onCall)) && (
        <section aria-labelledby="live-how" className="flex max-w-[640px] flex-col gap-4 rounded-card bg-surface p-5 shadow-1">
          <h2 id="live-how" className="text-[16px] font-semibold">Get tips while you talk</h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[14px] leading-relaxed text-text2">
            <li>Call them from your phone and put it on <strong className="font-semibold text-text">speaker</strong>, near the laptop.</li>
            <li>Tell them: <span className="font-medium text-text">‘This call is assisted and may be noted for follow-up.’</span></li>
            <li>Tick the box and press Start. Tips show up each time they finish speaking.</li>
          </ol>
          {notSetUp ? (
            <Notice tone="warn">{notSetUp}</Notice>
          ) : (
            <>
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[10px] border border-line2 px-3 text-[14px] font-medium">
                <input type="checkbox" className="h-5 w-5 shrink-0" checked={consent} onChange={(e) => setConsent(e.target.checked)} required aria-required />
                <span>I told them this call is being listened to by our assistant</span>
              </label>
              <Button variant="primary" size="lg" className="h-14 px-8 text-base sm:self-start" leftIcon={<Mic size={18} />}
                disabled={!consent} loading={phase === 'starting'} onClick={start}>
                Start listening
              </Button>
              {!consent && <p className="-mt-2 text-[12.5px] text-muted">Tick the box first. The browser will then ask to use the microphone.</p>}
            </>
          )}
          {err && <Notice tone="bad">{err}</Notice>}
          <p className="text-[12.5px] text-muted">The sound is not saved. Only the summary you choose to log is kept on the lead.</p>
        </section>
      )}

      {onCall && (
        <>
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-card bg-surface p-3 shadow-2">
            {phase === 'live' ? (
              <span className="flex items-center gap-2 text-[13.5px] font-semibold text-goodText" role="status">
                <span className="relative flex h-2.5 w-2.5" aria-hidden>
                  <span className="absolute inline-flex h-full w-full rounded-full bg-goodText opacity-60 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-goodText" />
                </span>
                Listening
              </span>
            ) : (
              <span className="flex items-center gap-2 text-[13.5px] font-semibold text-badText" role="status">
                <span className="h-2.5 w-2.5 rounded-full bg-badText" aria-hidden /> Not listening
              </span>
            )}
            <span className="num text-[20px] font-semibold" aria-label={'Call time ' + fmtDuration(secs)}>{fmtDuration(secs)}</span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {phase === 'live' ? (
                <Button variant="cta" size="lg" leftIcon={<Square size={16} />} onClick={stop} aria-label="Stop listening and write the call summary">Stop and summarise</Button>
              ) : (
                <>
                  <Button variant="primary" size="lg" leftIcon={<Mic size={16} />} loading={phase === 'starting'} onClick={start}>Start</Button>
                  <Button variant="cta" size="lg" leftIcon={<Square size={16} />} disabled={phase === 'starting'} onClick={() => void summarise()}>End and summarise</Button>
                </>
              )}
            </div>
          </div>

          {phase === 'lost' && (
            <Notice tone="bad">{err || 'Lost the connection — tap Start to continue.'} What was said so far is kept.</Notice>
          )}

          <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            {/* Tips: first on a phone, the wide right column on a laptop */}
            <section aria-labelledby="tips-h" className="flex flex-col gap-4 rounded-card bg-surface p-5 shadow-1 lg:order-2">
              <div className="flex min-h-[24px] items-center justify-between gap-3">
                <h2 id="tips-h" className="text-[13px] font-semibold uppercase tracking-wide text-muted">Tips</h2>
                {tipsLoading && <span className="flex items-center gap-1.5 text-[12.5px] text-muted"><Loader2 size={13} className="btn-spin" aria-hidden /> Updating…</span>}
              </div>
              <div aria-live="polite" className="flex flex-col gap-5">
                {!tips ? (
                  <p className="text-[16px] text-muted">{tipsLoading ? 'Getting the first tips…' : 'Tips appear after they speak.'}</p>
                ) : (
                  <>
                    {tips.they_said && (
                      <div>
                        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">They said</h3>
                        <p className="mt-1 text-[15px] leading-snug text-text2">{tips.they_said}</p>
                      </div>
                    )}
                    <div className="rounded-card border-2 border-accent p-4">
                      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-accentText">Say this</h3>
                      <p className="mt-1.5 text-[21px] font-semibold leading-snug md:text-[24px]">{tips.say_this}</p>
                    </div>
                    {tips.careful && (
                      <div className="flex gap-3 rounded-card bg-warnBg p-4 text-warnText">
                        <AlertTriangle size={20} className="mt-0.5 shrink-0" aria-hidden />
                        <div>
                          <h3 className="text-[12px] font-semibold uppercase tracking-wide">Careful</h3>
                          <p className="mt-1 text-[15px] font-medium leading-snug">{tips.careful}</p>
                        </div>
                      </div>
                    )}
                    <div>
                      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Still to cover</h3>
                      {tips.still_to_cover.length ? (
                        <ul className="mt-1 flex flex-col">
                          {tips.still_to_cover.map((item) => {
                            const on = ticked.has(item);
                            return (
                              <li key={item}>
                                <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[15px]">
                                  <input type="checkbox" className="h-5 w-5 shrink-0" checked={on} onChange={() => toggleTick(item)} />
                                  <span className={cx(on && 'text-muted line-through')}>{item}</span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      ) : <p className="mt-1 text-[15px] text-muted">Nothing left to cover.</p>}
                    </div>
                    {tips.ask_for && (
                      <div>
                        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Ask for</h3>
                        <p className="mt-1 text-[17px] font-semibold leading-snug text-accentText">{tips.ask_for}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
              {tipsNote && <p className="text-[12.5px] text-muted" role="status">{tipsNote}</p>}
            </section>

            <section aria-labelledby="said-h" className="relative flex min-h-0 flex-col rounded-card bg-surface shadow-1 lg:order-1">
              <h2 id="said-h" className="px-4 pb-2 pt-4 text-[13px] font-semibold uppercase tracking-wide text-muted">What was said</h2>
              <div ref={listBox} onScroll={onListScroll} tabIndex={0} aria-label="What was said, newest at the bottom"
                className="max-h-[50vh] min-h-[200px] overflow-y-auto px-4 pb-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:max-h-[calc(100dvh-240px)]">
                <Transcript segments={segments} interim={interim} empty={phase === 'live' ? 'Words appear here as you talk.' : 'Nothing was heard yet.'} />
              </div>
              {scrolledUp && (
                <button type="button" onClick={jumpToNewest}
                  className="absolute bottom-3 left-1/2 flex min-h-[36px] -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink px-3 text-[12.5px] font-medium text-white shadow-2">
                  <ArrowDown size={14} aria-hidden /> Newest
                </button>
              )}
            </section>
          </div>
        </>
      )}

      {(phase === 'summarising' || phase === 'done') && (
        <section aria-labelledby="sum-h" className="flex max-w-[760px] flex-col gap-4 rounded-card bg-surface p-5 shadow-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="sum-h" className="text-[16px] font-semibold">Call summary</h2>
            <span className="num text-[13px] text-muted">Call length {fmtDuration(secs)}</span>
          </div>
          {phase === 'summarising' ? (
            <p role="status" className="flex items-center gap-2 text-[15px] text-text2"><Loader2 size={18} className="btn-spin" aria-hidden /> Writing the call summary…</p>
          ) : (
            <>
              {result && (
                <dl className="flex flex-col gap-3">
                  <div>
                    <dt className="text-[12px] font-semibold uppercase tracking-wide text-muted">Summary</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed">{result.summary}</dd>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <dt className="text-[12px] font-semibold uppercase tracking-wide text-muted">Outcome</dt>
                      <dd className="mt-1">{result.outcome ? <Pill>{result.outcome}</Pill> : <span className="text-muted">Not clear</span>}</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] font-semibold uppercase tracking-wide text-muted">Follow-up</dt>
                      <dd className="mt-1 text-[14px]">{result.follow_up || <span className="text-muted">None</span>}</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] font-semibold uppercase tracking-wide text-muted">When</dt>
                      <dd className="mt-1 text-[14px]">{result.follow_up_when || <span className="text-muted">—</span>}</dd>
                    </div>
                  </div>
                </dl>
              )}
              {resultErr && <Notice tone="warn">{resultErr}</Notice>}
              <p className="text-[12.5px] text-muted">Nothing is saved yet. “Log this call” opens the lead with the Log call box filled in, so you can check and save it.</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" size="lg" onClick={logCall}>Log this call</Button>
                <Confirm title="Discard this call?" body="What was said and the summary on this page will be cleared. Nothing was saved." yes="Discard" onYes={discard} align="left"
                  className="btn inline-flex h-11 items-center rounded-[10px] border border-line2 bg-surface px-5 text-sm font-medium text-badText hover:bg-badBg">
                  Discard
                </Confirm>
              </div>
              {segments.length > 0 && (
                <details className="rounded-[10px] border border-line">
                  <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-[13.5px] font-medium text-text2">Show what was said</summary>
                  <div className="max-h-[50vh] overflow-y-auto px-3 pb-3"><Transcript segments={segments} interim={null} empty="" /></div>
                </details>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}

function Transcript({ segments, interim, empty }: { segments: Seg[]; interim: Seg | null; empty: string }) {
  if (!segments.length && !interim) return empty ? <p className="text-[14px] text-muted">{empty}</p> : null;
  return (
    <>
      <ol aria-live="polite" aria-relevant="additions text" className="flex flex-col gap-3">
        {segments.map((sg, i) => (
          <li key={i}>
            <span className={cx('text-[12px] font-semibold', sg.speaker === 'Speaker 1' ? 'text-accentText' : 'text-text2')}>{sg.speaker}</span>
            <p className="text-[14px] leading-relaxed">{sg.text}</p>
          </li>
        ))}
      </ol>
      {interim && (
        <p className="mt-3 text-[14px] italic leading-relaxed text-muted" aria-hidden>
          <span className="mr-1.5 text-[12px] font-semibold not-italic">{interim.speaker}</span>{interim.text}
        </p>
      )}
    </>
  );
}
