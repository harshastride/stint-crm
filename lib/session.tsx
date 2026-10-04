'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { ChangePassword } from '@/components/ChangePassword';
import { AppSkeleton } from '@/components/Skeletons';

export type Staff = { id: string; full_name: string; email: string; role: string; level: string; branch_id: string | null; status: string; must_change_password?: boolean };
export type RefRow = { id: string; label: string; extra?: Record<string, unknown> };
export type PageRow = { id: string; grp: string; title: string; sort: number };
export type CustomField = { id: string; page_id: string; label: string; key: string; type: string; options: string | null; in_list: string; sort: number };

type Session = {
  staff: Staff;
  pages: Record<string, 'r' | 'w'>;          // what I may open, and whether I may edit
  fields: Record<string, 'f' | 'm' | 'h'>;   // sensitive groups: full, masked, hidden
  allPages: PageRow[];
  roles: string[];
  lists: Record<string, string[]>;           // dropdown values by list id (active only)
  refs: Record<string, RefRow[]>;            // small reference tables for pickers
  custom: CustomField[];                     // admin-defined fields (Admin settings → Custom fields)
  can: (page: string, need?: 'r' | 'w') => boolean;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<Session | null>(null);
export const useSession = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
};

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<Session, 'can' | 'reload' | 'signOut'> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mustChange, setMustChange] = useState(false);

  const load = useCallback(async (attempt = 0): Promise<void> => {
    const db = supabase();
    // Right after sign-in the database can be a moment behind the login server's clock and reject the
    // brand-new token as "issued at future". Wait and try again instead of showing an error.
    const early = await db.rpc('my_session');
    if (early.error && /issued at future/i.test(early.error.message) && attempt < 8) {
      await new Promise((r) => setTimeout(r, 750));
      return load(attempt + 1);
    }
    const [me, pages, roles, values, staff, programs, batches, branches, companies, sources, campaigns, custom] = await Promise.all([
      db.rpc('my_session'),
      db.from('page').select('*').order('sort'),
      db.from('app_role').select('name').order('sort'),
      db.from('dropdown_value').select('list_id,value,sort,active').eq('active', true).order('sort'),
      db.from('staff').select('id,full_name,role,status').order('full_name'),
      db.from('program').select('id,name,fee').order('name'),
      db.from('batch').select('id,code').order('code'),
      db.from('branch').select('id,name').order('name'),
      db.from('company').select('id,name').order('name'),
      db.from('lead_source').select('id,name').order('name'),
      db.from('campaign').select('id,name').order('name'),
      db.from('custom_field').select('*').order('sort').order('created_at'),
    ]);
    if (!me.error && !me.data?.staff) {
      // a student account belongs in the portal, not the staff CRM
      const { data: student } = await db.rpc('my_candidate');
      if (student) { window.location.replace('/portal'); return; }
    }
    if (me.error || !me.data?.staff) {
      setError(me.error?.message || 'Your login is not set up as a staff member yet. Ask an admin to add you under Users & staff.');
      return;
    }
    if (me.data.staff.must_change_password) { setMustChange(true); return; }
    setMustChange(false);
    if (me.data.staff.status !== 'Active') { setError('Your login is ' + me.data.staff.status.toLowerCase() + '. Ask an admin to activate it.'); return; }
    const lists: Record<string, string[]> = {};
    (values.data || []).forEach((v: { list_id: string; value: string }) => { (lists[v.list_id] ||= []).push(v.value); });
    setState({
      staff: me.data.staff, pages: me.data.pages || {}, fields: me.data.fields || {},
      allPages: (pages.data || []) as PageRow[],
      roles: (roles.data || []).map((r: { name: string }) => r.name),
      lists,
      custom: (custom.data || []) as CustomField[],
      refs: {
        staff: (staff.data || []).filter((s: { status: string }) => s.status !== 'Disabled').map((s: { id: string; full_name: string; role: string }) => ({ id: s.id, label: s.full_name, extra: { role: s.role } })),
        program: (programs.data || []).map((p: { id: string; name: string; fee: number }) => ({ id: p.id, label: p.name, extra: { fee: p.fee } })),
        batch: (batches.data || []).map((b: { id: string; code: string }) => ({ id: b.id, label: b.code })),
        branch: (branches.data || []).map((b: { id: string; name: string }) => ({ id: b.id, label: b.name })),
        company: (companies.data || []).map((c: { id: string; name: string }) => ({ id: c.id, label: c.name })),
        lead_source: (sources.data || []).map((s: { id: string; name: string }) => ({ id: s.id, label: s.name })),
        campaign: (campaigns.data || []).map((c: { id: string; name: string }) => ({ id: c.id, label: c.name })),
      },
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const value = useMemo<Session | null>(() => state && ({
    ...state,
    can: (page, need = 'r') => { const m = state.pages[page]; return need === 'r' ? !!m : m === 'w'; },
    reload: load,
    signOut: async () => { await supabase().auth.signOut(); window.location.href = '/login'; },
  }), [state, load]);

  if (mustChange) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-4">
        <div className="w-full max-w-[380px] rounded-2xl border border-line bg-surface p-7">
          <h1 className="mb-3 text-[22px] font-semibold">Set your password</h1>
          <ChangePassword forced onDone={() => { setMustChange(false); load(); }} />
          <button className="mt-3 h-11 w-full rounded-[10px] text-sm font-medium text-text2" onClick={async () => { await supabase().auth.signOut(); window.location.href = '/login'; }}>Sign out</button>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-line bg-surface p-6 text-center">
          <div className="text-lg font-semibold">Can’t open the CRM</div>
          <p className="mt-2 text-text2">{error}</p>
          <button className="mt-4 h-11 rounded-[10px] border border-line2 bg-surface px-4 font-medium" onClick={async () => { await supabase().auth.signOut(); window.location.href = '/login'; }}>Sign out</button>
        </div>
      </div>
    );
  }
  if (!value) return <AppSkeleton />;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
