import type { Topic } from './HelpList';

/** Help for students in the portal. Plain, friendly words. */
export const STUDENT_TOPICS: Topic[] = [
  { title: 'Getting started', items: [
    { q: 'Why does it ask me to choose a password?', a: 'The first time you log in, you pick your own password. Type it twice and press Save. Use this new password from now on.' },
    { q: 'What are the joining steps at the top?', a: 'They show what is left: My details, Documents, Sign agreement and Fees paid. Tap a step to go straight to it.' },
  ] },
  { title: 'My details', items: [
    { q: 'How do I fill my details?', a: 'Open the My details tab. Fill About you, your contact and other sections, and your education, then press Save.' },
    { q: 'Why can I not change my details any more?', a: 'You can edit them while you are enrolled or in training. After that they are locked. Ask your counsellor if something needs changing.' },
    { q: 'Who can see my private details?', a: 'Only the staff who need them. Your contact, family, ID and bank details are kept private.' },
  ] },
  { title: 'Documents', items: [
    { q: 'How do I upload a document?', a: 'Open the Documents tab. You will see the documents the institute asked for. Tap Upload next to one and pick the file.' },
    { q: 'How do I know my document was accepted?', a: 'Each document shows its status. If it is sent back, the reason is shown. Upload a new file to fix it.' },
  ] },
  { title: 'Fees & agreement', items: [
    { q: 'How do I sign the fee agreement?', a: 'Open the Fees tab. Read the agreement, tick "I have read and agree", then press Sign.' },
    { q: 'Where are my payments and receipts?', a: 'Open the Fees tab. It shows what you paid, what is left, and your receipts.' },
    { q: 'I paid but it does not show. What now?', a: 'Payments are added by the institute. If one is missing after a day, ask your counsellor.' },
  ] },
  { title: 'My resumes', items: [
    { q: 'Where can I see my resume?', a: 'Open My resumes. You can view each version and its status. You cannot change them here.' },
    { q: 'Who approves my resume?', a: 'Your reviewer at the institute decides. If it is sent back, the reason is shown.' },
    { q: 'How do I get my resume changed?', a: 'Ask your counsellor. They will arrange a new version for you.' },
  ] },
  { title: 'Progress & interview practice', items: [
    { q: 'Where are my mock interviews and ratings?', a: 'Open My progress. It lists your mock interviews, their scores and feedback.' },
    { q: 'How do I practise for interviews?', a: 'Tap "Practise interview". It opens the Stint Interview Coach, already signed in. Your scores appear under My progress, and your trainer can see them too.' },
  ] },
  { title: 'Alerts', items: [
    { q: 'What are the cards that pop up?', a: 'They are alerts from the institute, for example a new document request or a resume update. Tap Open to go there, or X to close it.' },
  ] },
  { title: 'Who to contact', items: [
    { q: 'Who do I ask for help?', a: 'Your counsellor. Their name and email are on the Overview tab, under My course.' },
    { q: 'I forgot my password.', a: 'Ask your counsellor. They can reset your access.' },
  ] },
];

export const STUDENT_HELP_FOOTER = 'Still stuck? Ask your counsellor.';
