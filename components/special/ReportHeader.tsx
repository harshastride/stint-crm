'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Funnel } from '../kit/Funnel';

// Shown above every rep_* report: the question it answers, how each number is defined,
// the period it covers and how fresh it is, plus links to the rows behind it.
type Def = { question: string; period: string; defs: [string, string][]; drill: [string, string][]; note?: string; extra?: React.ComponentType };

const NA = 'A dash (—) means not enough data: there was nothing to divide by.';
const REPORTS: Record<string, Def> = {
  rep_funnel: {
    question: 'How much new work came in, and how much did we enrol, place and collect, each month?',
    period: 'Last 6 calendar months, India time (IST). The current month is still running.',
    defs: [['Leads', 'Leads created in the month.'], ['Enrolled', 'Candidates whose joining date falls in the month.'], ['Placed', 'Placements recorded in the month, excluding Dropped.'], ['Fees collected', 'Payments marked Received, by paid date.']],
    note: 'Each column counts its own events in that month. These are not the same people moving down, so do not read one column as a conversion rate of another.',
    drill: [['Leads', '/p/lead'], ['Candidates', '/p/candidate'], ['Placements', '/p/placement'], ['Payments', '/p/payment']],
    extra: Funnel,
  },
  rep_roi: {
    question: 'Which lead sources turn into enrolments and fees?',
    period: 'All time. Each source is followed through its own leads.',
    defs: [['Leads', 'All leads tagged with the source.'], ['Enrolled', 'Of those leads, how many became a candidate (each lead once).'], ['Enrol %', 'Enrolled ÷ Leads for that source.'], ['Fees booked', 'Fee plan totals of those candidates.']],
    note: NA + ' Candidates added without a lead are not counted under any source.',
    drill: [['Leads', '/p/lead'], ['Lead sources', '/p/source'], ['Candidates', '/p/candidate']],
  },
  rep_batch: {
    question: 'Which batches have weak attendance or mock results?',
    period: 'All time, for each batch.',
    defs: [['Students', 'Candidates currently in the batch.'], ['Attendance', 'Present marks ÷ all attendance marks taken for the batch.'], ['Mock pass', 'Passed ÷ (Passed + Failed) mocks of the batch’s current students. Not yet graded mocks are left out.']],
    note: NA,
    drill: [['Batches', '/p/batch'], ['Mocks', '/p/mock'], ['Candidates', '/p/candidate']],
  },
  rep_place: {
    question: 'How well does each program place its candidates, and at what pay?',
    period: 'All time, by the candidate’s program.',
    defs: [['Placed', 'Placements not Dropped (a person placed twice counts twice).'], ['Placement rate', 'Candidates with at least one placement ÷ all candidates in the program.'], ['Avg CTC', 'Average offered CTC in lakhs per year.'], ['Days to place', 'Average days from joining date to the placement being recorded (IST).']],
    note: NA,
    drill: [['Placements', '/p/placement'], ['Candidates', '/p/candidate']],
  },
  rep_cash: {
    question: 'How much fee have we booked, collected and still have overdue, by program?',
    period: 'All time, for every fee plan.',
    defs: [['Booked', 'Fee plan totals.'], ['Collected', 'Received payments against those plans.'], ['Overdue', 'Unpaid balance on plans with an instalment past due.'], ['Collected %', 'Collected ÷ Booked.']],
    note: NA,
    drill: [['Fee plans', '/p/plan'], ['Overdue plans', '/p/plan?view=Overdue'], ['Payments', '/p/payment']],
  },
};

export function ReportHeader() {
  const id = (usePathname() || '').split('/').pop() || '';
  const d = REPORTS[id];
  const [at, setAt] = useState('');
  useEffect(() => { setAt(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })); }, [id]);
  if (!d) return null;
  const Extra = d.extra;
  return (
    <>
      <section aria-label="About this report" data-testid="report-header" className="flex flex-col gap-3 rounded-card bg-surface p-card shadow-1">
        <p className="text-[15px] font-semibold text-text">{d.question}</p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-text2">
          <span><b className="font-medium text-text">Period:</b> {d.period}</span>
          <span data-testid="report-freshness"><b className="font-medium text-text">Data:</b> live, loaded {at || 'now'} IST. Only rows your role can see.</span>
        </div>
        <details className="text-[13px] text-text2">
          <summary className="flex min-h-[44px] cursor-pointer items-center font-medium text-accent">How each number is worked out</summary>
          <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
            {d.defs.map(([k, v]) => <div key={k} className="contents"><dt className="font-medium text-text">{k}</dt><dd>{v}</dd></div>)}
          </dl>
          {d.note && <p className="mt-2">{d.note}</p>}
        </details>
        <nav aria-label="See the rows behind this report" className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted">See the rows:</span>
          {d.drill.map(([l, href]) => <Link key={href} href={href} className="inline-flex min-h-[44px] items-center rounded-[10px] border border-line2 px-3 hover:bg-accentSoft">{l}</Link>)}
        </nav>
      </section>
      {Extra && <Extra />}
    </>
  );
}
