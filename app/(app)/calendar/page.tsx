'use client';
import { useSession } from '@/lib/session';
import { WeekCalendar } from '@/components/special/WeekCalendar';

export default function CalendarPage() {
  const s = useSession();
  if (!s.can('calendar')) return <main className="flex-1 p-6 text-[14px] text-text2">Your role cannot open the calendar.</main>;
  return <WeekCalendar />;
}
