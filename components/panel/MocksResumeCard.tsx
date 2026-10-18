'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import type { Row } from '@/lib/pages';
import { CardRow, Chip, RailCard } from './RailCard';

type Tone = 'good' | 'warn' | 'bad' | 'info' | 'plain';
type Data = { mocks: Row[]; fb: Row[]; res: Row[]; vend: Row[] };

/** "11 Oct". Plain dates (due_on) are read as local days so they never slip by one. */
const short = (v: unknown) => {
  if (!v) return '';
  const s = String(v);
  const d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const mockTone = (st: string): Tone => (st === 'Passed' ? 'good' : st === 'Failed' ? 'bad' : st === 'Booked' ? 'info' : 'plain');
const mockWord = (st: string) => (st === 'Booked' ? 'Booked' : st);
const verdictTone = (v: string): Tone => (v === 'Ready' ? 'good' : v === 'Not ready' ? 'bad' : v === 'Rebook' ? 'warn' : 'plain');
const resumeTone = (st: string): Tone => (st === 'Approved' ? 'good' : st === 'Rejected' ? 'warn' : st === 'Pending' ? 'info' : 'plain');
const resumeWord = (st: string) => (st === 'Rejected' ? 'Sent back' : st === 'Pending' ? 'In review' : st);
const vendorTone = (st: string): Tone => (st === 'Done' ? 'good' : st === 'In progress' || st === 'Open' ? 'info' : 'plain');

type Item = { key: string; at: number; title: string; sub: string; chip: { tone: Tone; text: string } };

/** Mock interviews, expert feedback and resume work for one person, as one card in the person panel. */
export function MocksResumeCard({ candidateId, open, onToggle, reloadKey }: { candidateId: string; open: boolean; onToggle: (id: string) => void; reloadKey?: number }) {
  const s = useSession();
  const cMock = s.can('mock'), cSme = s.can('sme'), cResume = s.can('resume'), cVendor = s.can('vendor');
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    let stale = false;
    const db = supabase();
    const empty = Promise.resolve({ data: [] as Row[] });
    (async () => {
      const [mocks, fb, res, vend] = await Promise.all([
        cMock ? db.from('mock_session').select('id, level, status, scheduled_at, created_at, trainer:trainer_id(full_name)').eq('candidate_id', candidateId).order('scheduled_at', { ascending: false, nullsFirst: false }).limit(10) : empty,
        cSme ? db.from('sme_feedback').select('id, mock_session_id, rating, verdict, comments, created_at, sme:sme_id(full_name)').eq('candidate_id', candidateId).order('created_at', { ascending: false }).limit(10) : empty,
        cResume ? db.from('resume_version').select('id, version, status, reason, created_at, reviewer:reviewer_id(full_name)').eq('candidate_id', candidateId).order('created_at', { ascending: false }).limit(10) : empty,
        cVendor ? db.from('vendor_request').select('id, vendor, request, status, due_on, created_at').eq('candidate_id', candidateId).ilike('request', '%resume%').order('created_at', { ascending: false }).limit(10) : empty,
      ]);
      if (stale) return;
      setData({ mocks: (mocks.data as Row[]) || [], fb: (fb.data as Row[]) || [], res: (res.data as Row[]) || [], vend: (vend.data as Row[]) || [] });
    })();
    return () => { stale = true; };
  }, [candidateId, reloadKey, cMock, cSme, cResume, cVendor]);

  if (!(cMock || cSme || cResume || cVendor) || !data) return null;
  const { mocks, fb, res, vend } = data;
  if (!mocks.length && !fb.length && !res.length && !vend.length) return null;

  // Closed line: one chip, the most important thing first.
  const latestRes = res[0], latestFb = fb[0], latestMock = mocks[0];
  let chip: { tone: Tone; text: string };
  if (latestRes?.status === 'Rejected') chip = { tone: 'warn', text: 'Resume sent back' };
  else if (latestFb?.verdict === 'Ready') chip = { tone: 'good', text: 'Mock: Ready' };
  else if (latestMock) {
    const st = String(latestMock.status || '');
    const d = short(latestMock.scheduled_at);
    chip = { tone: mockTone(st), text: st === 'Booked' ? `Mock ${d ? 'on ' + d : 'booked'}` : `Mock ${st.toLowerCase()}` };
  } else if (latestFb?.verdict) chip = { tone: verdictTone(String(latestFb.verdict)), text: `Mock: ${latestFb.verdict}` };
  else if (latestRes) chip = { tone: resumeTone(String(latestRes.status)), text: `Resume ${resumeWord(String(latestRes.status)).toLowerCase()}` };
  else chip = { tone: vendorTone(String(vend[0].status)), text: `Resume help ${String(vend[0].status).toLowerCase()}` };

  // Open body: newest first.
  const items: Item[] = [];
  for (const m of mocks) {
    const f = fb.find((x) => x.mock_session_id === m.id);
    const who = f?.sme?.full_name || m.trainer?.full_name;
    const sub = [who?.split(' ')[0], short(m.scheduled_at), f?.rating ? `${f.rating} of 5` : '', f?.comments].filter(Boolean).join(' · ');
    items.push({ key: 'm' + m.id, at: Date.parse(String(m.scheduled_at || m.created_at)) || 0, title: `Mock interview ${m.level}`, sub, chip: { tone: mockTone(String(m.status)), text: mockWord(String(m.status)) } });
  }
  for (const f of fb) {
    if (f.mock_session_id && mocks.some((m) => m.id === f.mock_session_id)) continue;
    const sub = [f.sme?.full_name?.split(' ')[0], short(f.created_at), f.rating ? `${f.rating} of 5` : '', f.comments].filter(Boolean).join(' · ');
    items.push({ key: 'f' + f.id, at: Date.parse(String(f.created_at)) || 0, title: 'Expert feedback', sub, chip: { tone: verdictTone(String(f.verdict || '')), text: String(f.verdict || 'Noted') } });
  }
  for (const r of res) {
    const sub = [r.reviewer?.full_name?.split(' ')[0], r.reason].filter(Boolean).join(': ');
    items.push({ key: 'r' + r.id, at: Date.parse(String(r.created_at)) || 0, title: `Resume ${r.version}`, sub, chip: { tone: resumeTone(String(r.status)), text: resumeWord(String(r.status)) } });
  }
  for (const v of vend) {
    items.push({ key: 'v' + v.id, at: Date.parse(String(v.created_at)) || 0, title: `${v.request} · ${v.vendor}`, sub: v.due_on ? `Due ${short(v.due_on)}` : '', chip: { tone: vendorTone(String(v.status)), text: String(v.status) } });
  }
  items.sort((a, b) => b.at - a.at);

  return (
    <RailCard id="mocks" label="Mocks and resume" testId="card-mocks" open={open} onToggle={onToggle}
      summary={<Chip tone={chip.tone}>{chip.text}</Chip>}>
      <div>
        {items.slice(0, 5).map((i) => <CardRow key={i.key} title={i.title} sub={i.sub || undefined} right={<Chip tone={i.chip.tone}>{i.chip.text}</Chip>} />)}
      </div>
      {items.length > 5 && <div className="pt-1.5 text-[11.5px] text-muted">Showing the latest 5 of {items.length}.</div>}
      <Link href={`/candidate/${candidateId}`} className="mt-2 inline-block text-[12.5px] text-accentText hover:underline">Open full profile</Link>
    </RailCard>
  );
}
