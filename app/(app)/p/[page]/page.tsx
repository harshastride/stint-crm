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

const SPECIAL: Record<string, React.ComponentType> = { home: Dashboard, enquiry: EnquiryForm, enrolform: EnrolmentForm, attendance: Attendance, roles: RolesGrid, dropdowns: Dropdowns, imports: ImportPage, builder: BuilderPage };

export default function Page({ params }: { params: Promise<{ page: string }> }) {
  const { page } = use(params);
  const s = useSession();
  if (!s.can(page)) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-sm rounded-2xl border border-line bg-surface p-6 text-center">
          <div className="text-lg font-semibold">This page isn’t open to your role</div>
          <p className="mt-2 text-text2">{s.staff.role} can’t open it. An admin can change that under Roles &amp; permissions.</p>
        </div>
      </main>
    );
  }
  const Special = SPECIAL[page];
  if (Special) return <Special />;
  const cfg = PAGES[page];
  if (!cfg) return <main className="p-6 text-text2">This page has not been built yet.</main>;
  return <Suspense fallback={<main className="p-6 text-muted">Loading…</main>}><ListPage cfg={cfg} /></Suspense>;
}
