import { Bone } from '../Skeletons';

// Placeholder number cards while the dashboard loads: same size as the real cards, so nothing jumps.
export function StatSkeleton({ count = 4 }: { count?: number }) {
  return (
    <section aria-label="Loading headline numbers" aria-busy="true" data-testid="stat-skeleton" className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col rounded-2xl border border-line bg-surface">
          <div className="px-5 pb-3 pt-4">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2"><Bone className="h-7 w-7 rounded-lg" /><Bone className="h-3.5 w-24" /></span>
              <Bone className="h-5 w-12" />
            </div>
            <Bone className="mt-3 h-7 w-20" />
            <Bone className="mt-2 h-3 w-16" />
            <Bone className="mt-3 h-9 w-full" />
          </div>
          <div className="mt-auto flex justify-end border-t border-line px-5 py-3"><Bone className="h-3.5 w-12" /></div>
        </div>
      ))}
    </section>
  );
}
