'use client';
import { Suspense, use } from 'react';
import { useSession } from '@/lib/session';
import { PAGES } from '@/lib/pages';
import { ListPage } from '@/components/ListPage';
import { Dashboard } from '@/components/special/Dashboard';
import { EnquiryForm } from '@/components/special/EnquiryForm';
import { EnrolmentForm } from '@/components/special/EnrolmentForm';
import { Attendance } from '@/components/special/Attendance';
import { RolesGrid } from '@/components/special/RolesGrid';
import { Dropdowns } from '@/components/special/Dropdowns';
import { ImportPage } from '@/components/special/ImportPage';
import { BuilderPage } from '@/components/special/BuilderPage';
import { redirect } from 'next/navigation';
import { Duplicates } from '@/components/special/Duplicates';
import { ReportBuilder } from '@/components/special/ReportBuilder';
import { StageRules } from '@/components/special/StageRules';
import { Reminders } from '@/components/special/Reminders';
import { AuditLog } from '@/components/special/AuditLog';
import { PageSkeleton } from '@/components/Skeletons';

const SPECIAL: Record<string, React.ComponentType> = { home: Dashboard, enquiry: EnquiryForm, enrolform: EnrolmentForm, attendance: Attendance, roles: RolesGrid, dropdowns: Dropdowns, imports: ImportPage, builder: BuilderPage, duplicates: Duplicates, reminders: Reminders, stage_rules: StageRules, audit: AuditLog, reports_builder: ReportBuilder };

export default function Page({ params }: { params: Promise<{ page: string }> }) {
  const { page } = use(params);
  if (page === 'calendar') redirect('/calendar'); // old month-calendar address, kept for bookmarks
  const s = useSession();
  if (!s.can(page)) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-sm rounded-card bg-surface p-6 text-center shadow-1">
          <div className="text-lg font-semibold">This page isn’t open to your role</div>
          <p className="mt-2 text-text2">{s.staff.role} can’t open it. An admin can change that under Roles &amp; permissions.</p>
        </div>
      </main>
    );
  }
  const Special = SPECIAL[page];
  if (Special) return <Suspense fallback={<PageSkeleton />}><Special /></Suspense>;
  const cfg = PAGES[page];
  if (!cfg) return <main className="p-page-sm text-text2 md:p-page">This page has not been built yet.</main>;
  return <Suspense fallback={<PageSkeleton />}><ListPage cfg={cfg} /></Suspense>;
}
