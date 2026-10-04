-- Details printed on fee quotes and receipts (editable on Admin settings → Branding & sidebar)
insert into public.setting (key, value) values
  ('institute_name', 'Stint Academy'),
  ('institute_address', 'HSR Layout, Bengaluru, Karnataka'),
  ('institute_phone', ''),
  ('institute_email', ''),
  ('institute_gstin', ''),
  ('quote_terms', 'Fees once paid are not refundable after the batch starts. Instalments are due on the dates shown. This quote is valid until the date above.'),
  ('receipt_note', 'Thank you. Keep this receipt for your records.')
on conflict (key) do nothing;
