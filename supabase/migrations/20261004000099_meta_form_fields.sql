-- Answers from Meta lead forms (and other ad forms) kept as lead fields, so telecallers see them on the lead and
-- lists can filter by them. They are ordinary custom fields: Admin can rename them, change the choices or hide them
-- under Admin settings → Custom fields. The incoming lead door (/api/integrations/lead) fills them from `custom`.
-- Choice options are short on purpose: the door matches Meta's long answer text to the option it contains
-- ("Yes, I have 5–8 years of experience." → "5–8 years"), so keep each option a phrase found in the form's answers.

insert into public.custom_field (page_id, label, type, options, in_list, sort) values
  ('lead', 'Experience', 'Choice', '3-5 years, 5-8 years, 8+ years', 'Yes', 10),
  ('lead', 'Background', 'Choice', 'IT Professional, Non-IT Professional, Career break', 'Yes', 11),
  ('lead', 'Fee plan', 'Choice', 'Comfortable, Know more', 'Yes', 12),
  ('lead', 'Ad set', 'Text', null, 'No', 13),
  ('lead', 'Ad name', 'Text', null, 'No', 14)
on conflict (page_id, key) do nothing;
