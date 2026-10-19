One file per feature, run by scripts/test-security.mjs in name order (NN-name.mjs).
Each file exports `default async function ({ env, createClient, check, admin, tele, sales, trainer, fin, desk, hr, mkt, anon, service })`.
Signed-in clients: admin (Admin), tele (Telecaller), sales (Sales), trainer (Trainer), fin (Finance), desk (Front desk), hr (HR / Counsellor), mkt (Marketing); anon (signed out); service (service role).
Clean up every row you create.
