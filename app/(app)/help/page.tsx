'use client';
import { HelpList, type Topic } from '@/components/kit/HelpList';

const TOPICS: Topic[] = [
  { title: 'Leads & calls', roles: 'Front desk · Marketing · Telecaller · Sales', items: [
    { q: 'How do I add a new lead?', a: 'Open the Leads page and press New. Fill the name, phone and course, then Save. Leads from forms and ads arrive by themselves.' },
    { q: 'How do I log a call?', a: 'Open the lead from the list. In the side panel press "Log call", pick the result and the next follow-up date, then Save.' },
    { q: 'Where are the people I need to call today?', a: 'Account menu (your name, top right) → My follow-ups. It lists everything due for you, oldest first.' },
    { q: 'How do I book counselling or send a fee quote?', a: 'Open the lead and press "Book counselling" or "Send fee quote" in the side panel. The person is filled in for you.' },
  ] },
  { title: 'Enrolment', roles: 'Sales · HR / Counsellor · Front desk', items: [
    { q: 'How do I turn a lead into a student?', a: 'Open the lead and press "Convert to student". This creates the candidate and keeps the call history.' },
    { q: 'How do I fill the student\'s details?', a: 'Press "Open data sheet" on the candidate. Private details (contact, family, ID, bank) are only shown to roles allowed to see them.' },
    { q: 'How do I put a student in a batch?', a: 'Open the candidate and press "Assign batch", pick the batch and Save.' },
  ] },
  { title: 'Training & mocks', roles: 'Trainer · SME', items: [
    { q: 'How do I mark attendance?', a: 'Open the Attendance page (or press "Mark attendance"), pick the batch and date, tick who came, then Save.' },
    { q: 'How do I add a training note?', a: 'Open the candidate and press "Training note". Write what was covered and how the student did.' },
    { q: 'How do I book a mock interview?', a: 'Open the candidate and press "Book mock". Pick the date and the interviewer, then Save. Add the score after the mock.' },
  ] },
  { title: 'Resumes & documents', roles: 'Trainer · SME · Placement · HR', items: [
    { q: 'How do I add a resume?', a: 'Open the candidate and press "Add resume". Upload the file and Save. It goes to the assigned reviewer.' },
    { q: 'How do I ask a student for a document?', a: 'Open the candidate and press "Request document", pick the document type and Save.' },
    { q: 'Who can change a resume or document status?', a: 'Only the assigned reviewer, trainer or owner (or their team head) can change the status. Others can see it but not change it.' },
  ] },
  { title: 'Placement', roles: 'Placement', items: [
    { q: 'How do I send a profile to a vendor?', a: 'Open the candidate and press "Send to vendor". Pick the vendor and Save.' },
    { q: 'How do I record a placement?', a: 'Open the candidate and press "Record placement". Add the company, role, salary and joining date.' },
    { q: 'What is the joining checklist?', a: 'Press "Joining checklist" on a placed candidate. It lists the papers needed, based on the real joining and leaving dates.' },
    { q: 'How do I log an alumni check-in?', a: 'Open the candidate and press "Log check-in". Note how they are doing at work.' },
  ] },
  { title: 'Fees & receipts', roles: 'Finance · Sales', items: [
    { q: 'How do I record a payment?', a: 'Open the candidate and press "Record payment". Enter the amount and mode, then Save.' },
    { q: 'How do I set up instalments?', a: 'Open the candidate and press "Fee plan". Add the instalments and due dates.' },
  ] },
  { title: 'Student portal', roles: 'Everyone', items: [
    { q: 'What can students see?', a: 'Students see only their own course, batch, attendance, fees and documents. They never see staff notes.' },
    { q: 'A student cannot log in. What do I do?', a: 'Check their email is correct on the candidate. If it still fails, ask your admin to reset their access.' },
  ] },
  { title: 'Automations', roles: 'Admin', items: [
    { q: 'Why did a follow-up appear by itself?', a: 'Rules and automations create follow-ups (for example after a missed call). They show in My follow-ups with the right button.' },
    { q: 'Where do website and ad leads come from?', a: 'They are sent in automatically and appear on the Leads page. Ask your admin if a source stops working.' },
  ] },
  { title: 'My account', roles: 'Everyone', items: [
    { q: 'How do I change my password?', a: 'Account menu (your name, top right) → Change password.' },
    { q: 'How do I switch to dark mode?', a: 'Account menu → Theme. Pick Light, Dark or Same as device.' },
    { q: 'Can I get the guided tour again?', a: 'Yes. Account menu → Show me around.' },
    { q: 'Are there keyboard shortcuts?', a: 'Yes. Press ? (question mark) anywhere, or Account menu → Keyboard shortcuts.' },
    { q: 'Why can\'t I see a page?', a: 'Each role sees only the pages it needs. Ask your admin if you need more access.' },
  ] },
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <h1 className="text-[22px] font-semibold">Help</h1>
      <p className="mt-1 text-[13.5px] text-muted">Short answers to common questions. Tap a question to see the answer.</p>
      <HelpList topics={TOPICS} footer="Still stuck? Ask your admin." />
    </div>
  );
}
