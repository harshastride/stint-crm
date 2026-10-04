// One icon per page and per action, from the Lucide family (one of the families on 21st.dev/community/icons).
// Used by the sidebar, the dashboard tiles and the quick panel's next-step buttons.
import {
  AlarmClock, BadgeIndianRupee, BarChart3, Bell, BookOpen, Briefcase, Building2, CalendarCheck, ClipboardCheck, ClipboardList, Cable,
  FileCheck2, FileSpreadsheet, FileStack, FileText, Filter, GitBranch, GraduationCap, HandCoins, History, Home, Inbox, IndianRupee, LayoutGrid,
  ListChecks, ListTodo, type LucideIcon, Megaphone, MessageSquareText, Mic, NotebookPen, Palette, PhoneCall, PieChart, Receipt, Route, ScrollText,
  Send, Shield, Shuffle, SlidersHorizontal, Target, TrendingUp, Upload, UserPlus, UserRoundCheck, Users, UsersRound, Wallet, Workflow, Zap,
} from 'lucide-react';

export const PAGE_ICON: Record<string, LucideIcon> = {
  home: Home, followups: ListTodo, enquiry: UserPlus, enrolform: ClipboardList,
  campaign: Megaphone, source: Filter, lead: Inbox, call: PhoneCall, recordings: Mic,
  counsel: MessageSquareText, quote: Receipt, target: Target,
  candidate: UsersRound, program: BookOpen, branch: Building2, batch: GraduationCap,
  attendance: CalendarCheck, note: NotebookPen, mock: UserRoundCheck, sme: ClipboardCheck,
  resume: FileText, doc: FileStack, vendor: Send, jobdocs: FileCheck2,
  placement: Briefcase, checklist: ListChecks, alumni: Users,
  plan: Wallet, payment: HandCoins, alert: Bell, history: History, company: Building2,
  rep_funnel: Route, rep_roi: TrendingUp, rep_batch: BarChart3, rep_place: PieChart, rep_cash: BadgeIndianRupee,
  users: Users, roles: Shield, assign: Shuffle, followrules: AlarmClock, dropdowns: SlidersHorizontal, imports: Upload,
  automations: Zap, builder: Workflow, connections: Cable, deliveries: ScrollText, branding: Palette,
};
export const pageIcon = (id: string): LucideIcon => PAGE_ICON[id] || LayoutGrid;

// next-step buttons (lib/nextSteps.ts keys)
export const STEP_ICON: Record<string, LucideIcon> = {
  call: PhoneCall, counsel: MessageSquareText, quote: Receipt, convert: GitBranch, datasheet: ClipboardList, batch: GraduationCap,
  payment: IndianRupee, plan: Wallet, attendance: CalendarCheck, note: NotebookPen, mock: UserRoundCheck, resume: FileText, doc: FileStack,
  vendor: Send, placement: Briefcase, checklist: ListChecks, alumni: Users, sheet: FileSpreadsheet,
};
