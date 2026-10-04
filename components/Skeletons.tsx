// Grey shapes where content is about to appear, shaped like what replaces them. Hidden from screen readers;
// each wrapper says "Loading" once for them instead.
import { cx } from './ui';

export const Bone = ({ className }: { className?: string }) => <span aria-hidden className={cx('block animate-pulse rounded-md bg-line motion-reduce:animate-none', className)} />;
const Wrap = ({ children, className }: { children: React.ReactNode; className?: string }) => <div role="status" aria-label="Loading" className={className}>{children}</div>;

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Wrap className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex gap-6 bg-surface2 px-4 py-3">{[24, 16, 20, 14, 12].map((w, i) => <Bone key={i} className={cx("h-3", w > 18 ? "w-28" : "w-16")} />)}</div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-6 border-t border-line px-4 py-3.5">
          <Bone className="h-3.5 w-40" /><Bone className="h-3 w-24" /><Bone className="h-3 w-28" /><Bone className="h-5 w-16 rounded-full" /><Bone className="ml-auto h-3 w-20" />
        </div>
      ))}
    </Wrap>
  );
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <Wrap className="grid gap-3" >
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {Array.from({ length: count }, (_, i) => <div key={i} className="rounded-2xl border border-line bg-surface p-4"><Bone className="h-3 w-24" /><Bone className="mt-3 h-7 w-16" /></div>)}
      </div>
    </Wrap>
  );
}

export function PageSkeleton() {
  return (
    <main className="flex flex-1 flex-col gap-5 p-4 md:p-8">
      <Wrap className="flex flex-col gap-2"><Bone className="h-3 w-24" /><Bone className="h-8 w-72" /><Bone className="h-3.5 w-96 max-w-full" /></Wrap>
      <CardsSkeleton />
      <div className="grid gap-4 lg:grid-cols-3"><div className="rounded-2xl border border-line bg-surface p-5 lg:col-span-2"><Bone className="h-4 w-48" /><Bone className="mt-4 h-[180px] w-full" /></div><div className="rounded-2xl border border-line bg-surface p-5"><Bone className="h-4 w-32" /><Bone className="mt-4 h-20 w-full" /></div></div>
      <TableSkeleton rows={4} />
    </main>
  );
}

export function PanelSkeleton() {
  return (
    <Wrap className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-[12px] bg-surface2 p-3"><Bone className="h-11 w-11 rounded-[10px]" /><div className="flex flex-1 flex-col gap-2"><Bone className="h-4 w-36" /><Bone className="h-3 w-48" /></div></div>
      <Bone className="h-9 w-full rounded-[10px]" /><Bone className="h-16 w-full rounded-[10px]" /><Bone className="h-16 w-full rounded-[10px]" />
    </Wrap>
  );
}

/** Whole-app first load: the sidebar and top bar shapes. */
export function AppSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex h-screen">
      <div className="hidden w-[232px] flex-col gap-3 border-r border-line bg-surface p-4 md:flex">
        <Bone className="h-7 w-28" />{Array.from({ length: 10 }, (_, i) => <Bone key={i} className={cx('h-3.5', i % 3 ? 'w-36' : 'w-20')} />)}
      </div>
      <div className="flex flex-1 flex-col"><div className="flex gap-2 border-b border-line bg-surface p-3"><Bone className="h-10 w-80 max-w-full" /><Bone className="ml-auto h-10 w-40" /></div><PageSkeleton /></div>
    </div>
  );
}
