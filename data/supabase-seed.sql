-- WorkFlow Pro Supabase seed export

-- schemaVersion: 6

-- tenants: 1, tenantRecords: 28, superAdmins: 1, globalRecords: 5, auditLogs: 48, errorEvents: 0

begin;

set local statement_timeout = '30s';

insert into tenants (id, name, plan, status, billing_email, data)
values ('t_demo', 'ABMS Consultancy BV', 'business', 'trial', 'finance@demobouw.be', '{"invoiceProfile":{"vat":"BE0897225572","companyNumber":"0897225572","street":"Stationsstraat 44","postalCode":"2800","city":"Mechelen","country":"Belgie","kboSyncedAt":"2026-04-29T19:44:15.530Z"},"onboarding":{"company":true},"billingOps":{"invoiceHistory":[{"id":"INV-2026-KACDHY","at":"2026-04-28","dueDate":"2026-05-12","line":"Eerste jaarlicentie WorkFlow Pro","gross":12,"discountPct":0,"net":12,"status":"draft","peppolStatus":"missing_peppol","enterpriseContract":false},{"id":"INV-2026-NO992G","at":"2026-04-28","dueDate":"2026-05-12","line":"Eerste jaarlicentie WorkFlow Pro","gross":12,"discountPct":0,"net":12,"status":"draft","peppolStatus":"missing_peppol","enterpriseContract":false},{"id":"INV-2026-5BU62A","at":"2026-04-28","dueDate":"2026-05-12","line":"Eerste jaarlicentie WorkFlow Pro","gross":12,"discountPct":0,"net":12,"status":"draft","peppolStatus":"missing_peppol","enterpriseContract":false},{"id":"INV-2026-QLO0D8","at":"2026-04-28","dueDate":"2026-05-12","line":"Eerste jaarlicentie WorkFlow Pro","gross":12,"discountPct":0,"net":12,"status":"draft","peppolStatus":"missing_peppol","enterpriseContract":false},{"id":"INV-2026-HY5JIL","at":"2026-04-28","dueDate":"2026-05-12","line":"Eerste jaarlicentie WorkFlow Pro","gross":12,"discountPct":0,"net":12,"status":"draft","peppolStatus":"missing_peppol","enterpriseContract":false},{"id":"INV-2026-Q33Z8L","at":"2026-04-28","dueDate":"2026-05-12","line":"WorkFlow Pro jaarlicentie","gross":1200,"discountPct":0,"net":1200,"status":"draft","peppolStatus":"missing_peppol","enterpriseContract":false}],"paymentMethodTokenized":true,"paymentMethodRef":"pm_card_visa_mock","autoCharge":true},"supportAccess":{"enabled":false},"paymentMethod":"Card token opgeslagen","billingStatus":"paid"}'::jsonb)
on conflict (id) do update set name = excluded.name, plan = excluded.plan, status = excluded.status, billing_email = excluded.billing_email, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('users', 'u_super', null, '{"mfaEnabled":false,"mfaEnforced":false,"lastLoginAt":null,"failedLoginCount":0,"lockedUntil":null,"id":"u_super","tenantId":null,"name":"Super Admin","email":"super@workflowpro.be","passwordHash":"21e88d6f8b61e6a7edf963430a7c3591:f92f9a55908e7e103e0cae084e00f70d9dc91cfe42dd8e199af9cd7895b681f3","role":"super_admin","permissions":["*"],"active":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('users', 'u_admin', 't_demo', '{"mfaEnabled":false,"mfaEnforced":false,"lastLoginAt":null,"failedLoginCount":0,"lockedUntil":null,"id":"u_admin","tenantId":"t_demo","name":"Tenant Admin","email":"admin@demobouw.be","passwordHash":"51741dcf42335fac39307669e1a1e79d:63bc2207cd4fc99479c7131636707cb9522677d2a192cde4a8f693045af3fba3","role":"tenant_admin","permissions":["tenants","employees","planning","workorders","clockings","billing","settings","audit","venues","customers","expenses","messages","alerts","integrations","stock","vehicles","leaves"],"active":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('users', 'user_1777360515127', 't_demo', '{"mfaEnabled":false,"mfaEnforced":false,"lastLoginAt":null,"failedLoginCount":0,"lockedUntil":null,"id":"user_1777360515127","tenantId":"t_demo","name":"Eerste medewerker","email":"medewerker@demobouwgroepnv.be","role":"employee","permissions":["workorders","expenses","leaves","messages"],"active":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('users', 'user_1777361523661', 't_demo', '{"mfaEnabled":false,"mfaEnforced":false,"lastLoginAt":null,"failedLoginCount":0,"lockedUntil":null,"id":"user_1777361523661","tenantId":"t_demo","name":"Eerste medewerker","email":"medewerker@demobouwgroepnv.be","role":"employee","permissions":["workorders","expenses","leaves","messages"],"active":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('users', 'user_1777361525543', 't_demo', '{"mfaEnabled":false,"mfaEnforced":false,"lastLoginAt":null,"failedLoginCount":0,"lockedUntil":null,"id":"user_1777361525543","tenantId":"t_demo","name":"Eerste medewerker","email":"medewerker@demobouwgroepnv.be","role":"employee","permissions":["workorders","expenses","leaves","messages"],"active":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('users', 'user_1777390883723', 't_demo', '{"mfaEnabled":false,"mfaEnforced":false,"lastLoginAt":null,"failedLoginCount":0,"lockedUntil":null,"id":"user_1777390883723","tenantId":"t_demo","name":"Eerste medewerker","email":"medewerker@demobouwgroepnv.be","role":"employee","permissions":["workorders","expenses","leaves","messages"],"active":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('users', 'user_1777390984219', 't_demo', '{"mfaEnabled":false,"mfaEnforced":false,"lastLoginAt":null,"failedLoginCount":0,"lockedUntil":null,"id":"user_1777390984219","tenantId":"t_demo","name":"Eerste medewerker","email":"medewerker@demobouwgroepnv.be","role":"employee","permissions":["workorders","expenses","leaves","messages"],"active":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('roles', 'role_admin', 't_demo', '{"id":"role_admin","tenantId":"t_demo","name":"Admin","permissions":["*"],"locked":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('venues', 'venue_1777360515125', 't_demo', '{"id":"venue_1777360515125","tenantId":"t_demo","name":"Eerste werf","code":"EW","address":"Nog aan te vullen","active":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('venues', 'venue_1777361523660', 't_demo', '{"id":"venue_1777361523660","tenantId":"t_demo","name":"Eerste werf","code":"EW","address":"Nog aan te vullen","active":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('venues', 'venue_1777361525541', 't_demo', '{"id":"venue_1777361525541","tenantId":"t_demo","name":"Eerste werf","code":"EW","address":"Nog aan te vullen","active":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('venues', 'venue_1777390883719', 't_demo', '{"id":"venue_1777390883719","tenantId":"t_demo","name":"Eerste werf","code":"EW","address":"Nog aan te vullen","active":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('venues', 'venue_1777390984218', 't_demo', '{"id":"venue_1777390984218","tenantId":"t_demo","name":"Eerste werf","code":"EW","address":"Nog aan te vullen","active":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('shifts', 'shift_1777360515128', 't_demo', '{"id":"shift_1777360515128","tenantId":"t_demo","userId":"user_1777360515127","venueId":"venue_1777360515125","date":"2026-04-28","start":"08:00","end":"16:30","project":"Eerste klantopdracht","client":"Demo klant","billable":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('shifts', 'shift_1777361523662', 't_demo', '{"id":"shift_1777361523662","tenantId":"t_demo","userId":"user_1777361523661","venueId":"venue_1777361523660","date":"2026-04-28","start":"08:00","end":"16:30","project":"Eerste klantopdracht","client":"Demo klant","billable":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('shifts', 'shift_1777361525544', 't_demo', '{"id":"shift_1777361525544","tenantId":"t_demo","userId":"user_1777361525543","venueId":"venue_1777361525541","date":"2026-04-28","start":"08:00","end":"16:30","project":"Eerste klantopdracht","client":"Demo klant","billable":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('shifts', 'shift_1777390883729', 't_demo', '{"id":"shift_1777390883729","tenantId":"t_demo","userId":"user_1777390883723","venueId":"venue_1777390883719","date":"2026-04-28","start":"08:00","end":"16:30","project":"Eerste klantopdracht","client":"Demo klant","billable":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('shifts', 'shift_1777390984220', 't_demo', '{"id":"shift_1777390984220","tenantId":"t_demo","userId":"user_1777390984219","venueId":"venue_1777390984218","date":"2026-04-28","start":"08:00","end":"16:30","project":"Eerste klantopdracht","client":"Demo klant","billable":true}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('workorders', 'wo_1777360515142', 't_demo', '{"id":"wo_1777360515142","tenantId":"t_demo","userId":"user_1777360515127","venueId":"venue_1777360515125","title":"Eerste werkbon","client":"Demo klant","status":"Bezig","checklist":[{"label":"Werk controleren","done":false}]}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('workorders', 'wo_1777361523674', 't_demo', '{"id":"wo_1777361523674","tenantId":"t_demo","userId":"user_1777361523661","venueId":"venue_1777361523660","title":"Eerste werkbon","client":"Demo klant","status":"Bezig","checklist":[{"label":"Werk controleren","done":false}]}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('workorders', 'wo_1777361525555', 't_demo', '{"id":"wo_1777361525555","tenantId":"t_demo","userId":"user_1777361525543","venueId":"venue_1777361525541","title":"Eerste werkbon","client":"Demo klant","status":"Bezig","checklist":[{"label":"Werk controleren","done":false}]}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('workorders', 'wo_1777390883749', 't_demo', '{"id":"wo_1777390883749","tenantId":"t_demo","userId":"user_1777390883723","venueId":"venue_1777390883719","title":"Eerste werkbon","client":"Demo klant","status":"Bezig","checklist":[{"label":"Werk controleren","done":false}]}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('workorders', 'wo_1777390984234', 't_demo', '{"id":"wo_1777390984234","tenantId":"t_demo","userId":"user_1777390984219","venueId":"venue_1777390984218","title":"Eerste werkbon","client":"Demo klant","status":"Bezig","checklist":[{"label":"Werk controleren","done":false}]}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('clocks', 'clock_1777360515156', 't_demo', '{"id":"clock_1777360515156","tenantId":"t_demo","userId":"user_1777360515127","venueId":"venue_1777360515125","date":"2026-04-28","clockIn":"08:00","clockOut":"16:30"}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('clocks', 'clock_1777361523684', 't_demo', '{"id":"clock_1777361523684","tenantId":"t_demo","userId":"user_1777361523661","venueId":"venue_1777361523660","date":"2026-04-28","clockIn":"08:00","clockOut":"16:30"}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('clocks', 'clock_1777361525566', 't_demo', '{"id":"clock_1777361525566","tenantId":"t_demo","userId":"user_1777361525543","venueId":"venue_1777361525541","date":"2026-04-28","clockIn":"08:00","clockOut":"16:30"}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('clocks', 'clock_1777390883762', 't_demo', '{"id":"clock_1777390883762","tenantId":"t_demo","userId":"user_1777390883723","venueId":"venue_1777390883719","date":"2026-04-28","clockIn":"08:00","clockOut":"16:30"}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into tenant_records (collection, id, tenant_id, data)
values ('clocks', 'clock_1777390984249', 't_demo', '{"id":"clock_1777390984249","tenantId":"t_demo","userId":"user_1777390984219","venueId":"venue_1777390984218","date":"2026-04-28","clockIn":"08:00","clockOut":"16:30"}'::jsonb)
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777360515186_38b104cbb49fb', 't_demo', 'admin@demobouw.be', 'billing', 'invoice_created', 'INV-2026-KACDHY', '{"id":"audit_1777360515186_38b104cbb49fb","at":"2026-04-28T07:15:15.186Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"invoice_created","area":"billing","detail":"INV-2026-KACDHY"}'::jsonb, '2026-04-28T07:15:15.186Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777360515199_3a1c9125dc658', 't_demo', 'admin@demobouw.be', 'golden_path', 'golden_path_demo_created', '', '{"id":"audit_1777360515199_3a1c9125dc658","at":"2026-04-28T07:15:15.199Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"golden_path_demo_created","area":"golden_path"}'::jsonb, '2026-04-28T07:15:15.199Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777361500850_9a778f6082731', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777361500850_9a778f6082731","at":"2026-04-28T07:31:40.850Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-28T07:31:40.850Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777361518960_b208c8ccb70bd', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777361518960_b208c8ccb70bd","at":"2026-04-28T07:31:58.960Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-28T07:31:58.960Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777361523706_9a07fb00afcf98', 't_demo', 'admin@demobouw.be', 'billing', 'invoice_created', 'INV-2026-NO992G', '{"id":"audit_1777361523706_9a07fb00afcf98","at":"2026-04-28T07:32:03.706Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"invoice_created","area":"billing","detail":"INV-2026-NO992G"}'::jsonb, '2026-04-28T07:32:03.706Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777361523716_81b0ab67df20d8', 't_demo', 'admin@demobouw.be', 'golden_path', 'golden_path_demo_created', '', '{"id":"audit_1777361523716_81b0ab67df20d8","at":"2026-04-28T07:32:03.716Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"golden_path_demo_created","area":"golden_path"}'::jsonb, '2026-04-28T07:32:03.716Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777361525586_7abde1bdd38108', 't_demo', 'admin@demobouw.be', 'billing', 'invoice_created', 'INV-2026-5BU62A', '{"id":"audit_1777361525586_7abde1bdd38108","at":"2026-04-28T07:32:05.586Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"invoice_created","area":"billing","detail":"INV-2026-5BU62A"}'::jsonb, '2026-04-28T07:32:05.586Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777361525597_a5deb3f50f4b08', 't_demo', 'admin@demobouw.be', 'golden_path', 'golden_path_demo_created', '', '{"id":"audit_1777361525597_a5deb3f50f4b08","at":"2026-04-28T07:32:05.597Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"golden_path_demo_created","area":"golden_path"}'::jsonb, '2026-04-28T07:32:05.597Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777390752120_8f563aa06a0ee', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777390752120_8f563aa06a0ee","at":"2026-04-28T15:39:12.120Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-28T15:39:12.120Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777390883786_c497f9edd5dee', 't_demo', 'admin@demobouw.be', 'billing', 'invoice_created', 'INV-2026-QLO0D8', '{"id":"audit_1777390883786_c497f9edd5dee","at":"2026-04-28T15:41:23.786Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"invoice_created","area":"billing","detail":"INV-2026-QLO0D8"}'::jsonb, '2026-04-28T15:41:23.786Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777390883799_7f2ac20d2c644', 't_demo', 'admin@demobouw.be', 'golden_path', 'golden_path_demo_created', '', '{"id":"audit_1777390883799_7f2ac20d2c644","at":"2026-04-28T15:41:23.799Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"golden_path_demo_created","area":"golden_path"}'::jsonb, '2026-04-28T15:41:23.799Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777390977338_1241eb53f91ae', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777390977338_1241eb53f91ae","at":"2026-04-28T15:42:57.338Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-28T15:42:57.338Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777390984272_98543deb6e8ce', 't_demo', 'admin@demobouw.be', 'billing', 'invoice_created', 'INV-2026-HY5JIL', '{"id":"audit_1777390984272_98543deb6e8ce","at":"2026-04-28T15:43:04.272Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"invoice_created","area":"billing","detail":"INV-2026-HY5JIL"}'::jsonb, '2026-04-28T15:43:04.272Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777390984274_9f9554f0c779c', 't_demo', 'admin@demobouw.be', 'golden_path', 'golden_path_demo_created', '', '{"id":"audit_1777390984274_9f9554f0c779c","at":"2026-04-28T15:43:04.274Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"golden_path_demo_created","area":"golden_path"}'::jsonb, '2026-04-28T15:43:04.274Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777391242439_f18d0dec98ce6', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777391242439_f18d0dec98ce6","at":"2026-04-28T15:47:22.439Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-28T15:47:22.439Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777391848024_ce351f405ae2d8', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777391848024_ce351f405ae2d8","at":"2026-04-28T15:57:28.024Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-28T15:57:28.024Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777392229289_2d382825004ac8', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777392229289_2d382825004ac8","at":"2026-04-28T16:03:49.289Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-28T16:03:49.289Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777392503419_06f02dcbfad64', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777392503419_06f02dcbfad64","at":"2026-04-28T16:08:23.419Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-28T16:08:23.419Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777392513245_bc060c06ed4ef8', 't_demo', 'admin@demobouw.be', 'billing', 'invoice_created', 'INV-2026-Q33Z8L', '{"id":"audit_1777392513245_bc060c06ed4ef8","at":"2026-04-28T16:08:33.245Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"invoice_created","area":"billing","detail":"INV-2026-Q33Z8L"}'::jsonb, '2026-04-28T16:08:33.245Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777392515026_c8020b9b09b8a8', 't_demo', 'admin@demobouw.be', 'billing', 'payment_method_attached', '', '{"id":"audit_1777392515026_c8020b9b09b8a8","at":"2026-04-28T16:08:35.026Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"payment_method_attached","area":"billing"}'::jsonb, '2026-04-28T16:08:35.026Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777455495953_314bec8a9fa248', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777455495953_314bec8a9fa248","at":"2026-04-29T09:38:15.953Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-29T09:38:15.953Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777455598008_757e45186fbd4', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777455598008_757e45186fbd4","at":"2026-04-29T09:39:58.008Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-29T09:39:58.008Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777455628648_b14f29eaf544f8', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777455628648_b14f29eaf544f8","at":"2026-04-29T09:40:28.648Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-29T09:40:28.648Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777456232492_9f0fa6b67d50e', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777456232492_9f0fa6b67d50e","at":"2026-04-29T09:50:32.492Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-29T09:50:32.492Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777456901452_0f88b04390503', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777456901452_0f88b04390503","at":"2026-04-29T10:01:41.452Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-29T10:01:41.452Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777460425603_4e32e5bd6b761', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777460425603_4e32e5bd6b761","at":"2026-04-29T11:00:25.603Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-29T11:00:25.603Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777460455995_03c4f684fd0768', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777460455995_03c4f684fd0768","at":"2026-04-29T11:00:55.995Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-29T11:00:55.995Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777460457517_d50f2331f22de', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777460457517_d50f2331f22de","at":"2026-04-29T11:00:57.517Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-29T11:00:57.517Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777460458681_86f0b6a0761088', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777460458681_86f0b6a0761088","at":"2026-04-29T11:00:58.681Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-29T11:00:58.681Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777460774048_b9f827d40f373', null, 'super@workflowpro.be', 'auth', 'login', '', '{"id":"audit_1777460774048_b9f827d40f373","at":"2026-04-29T11:06:14.048Z","actor":"super@workflowpro.be","tenantId":null,"action":"login","area":"auth"}'::jsonb, '2026-04-29T11:06:14.048Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777460857073_0a662e6add4168', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777460857073_0a662e6add4168","at":"2026-04-29T11:07:37.073Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-29T11:07:37.073Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777460918669_9740f249bd447', null, 'super@workflowpro.be', 'auth', 'login', '', '{"id":"audit_1777460918669_9740f249bd447","at":"2026-04-29T11:08:38.669Z","actor":"super@workflowpro.be","tenantId":null,"action":"login","area":"auth"}'::jsonb, '2026-04-29T11:08:38.669Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777461496985_0b4e6b2cd1f37', null, 'super@workflowpro.be', 'auth', 'login', '', '{"id":"audit_1777461496985_0b4e6b2cd1f37","at":"2026-04-29T11:18:16.985Z","actor":"super@workflowpro.be","tenantId":null,"action":"login","area":"auth"}'::jsonb, '2026-04-29T11:18:16.985Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777461768213_45c119b39f9da', null, 'super@workflowpro.be', 'auth', 'login', '', '{"id":"audit_1777461768213_45c119b39f9da","at":"2026-04-29T11:22:48.213Z","actor":"super@workflowpro.be","tenantId":null,"action":"login","area":"auth"}'::jsonb, '2026-04-29T11:22:48.213Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777461815166_b6d4b3f0b7cc7', null, 'super@workflowpro.be', 'auth', 'login', '', '{"id":"audit_1777461815166_b6d4b3f0b7cc7","at":"2026-04-29T11:23:35.166Z","actor":"super@workflowpro.be","tenantId":null,"action":"login","area":"auth"}'::jsonb, '2026-04-29T11:23:35.166Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777462715800_c581146d298f1', null, 'super@workflowpro.be', 'auth', 'login', '', '{"id":"audit_1777462715800_c581146d298f1","at":"2026-04-29T11:38:35.800Z","actor":"super@workflowpro.be","tenantId":null,"action":"login","area":"auth"}'::jsonb, '2026-04-29T11:38:35.800Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777462717493_28801cb7ab056', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777462717493_28801cb7ab056","at":"2026-04-29T11:38:37.493Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-29T11:38:37.493Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777477045649_91a22cf946a55', null, 'super@workflowpro.be', 'auth', 'login', '', '{"id":"audit_1777477045649_91a22cf946a55","at":"2026-04-29T15:37:25.649Z","actor":"super@workflowpro.be","tenantId":null,"action":"login","area":"auth"}'::jsonb, '2026-04-29T15:37:25.649Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777478854803_7165c7908f56d', null, 'super@workflowpro.be', 'auth', 'login', '', '{"id":"audit_1777478854803_7165c7908f56d","at":"2026-04-29T16:07:34.803Z","actor":"super@workflowpro.be","tenantId":null,"action":"login","area":"auth"}'::jsonb, '2026-04-29T16:07:34.803Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777485631200_38735fb1698948', null, 'super@workflowpro.be', 'auth', 'login', '', '{"id":"audit_1777485631200_38735fb1698948","at":"2026-04-29T18:00:31.200Z","actor":"super@workflowpro.be","tenantId":null,"action":"login","area":"auth"}'::jsonb, '2026-04-29T18:00:31.200Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777491845668_92dd11b7975a2', null, 'super@workflowpro.be', 'auth', 'login', '', '{"id":"audit_1777491845668_92dd11b7975a2","at":"2026-04-29T19:44:05.668Z","actor":"super@workflowpro.be","tenantId":null,"action":"login","area":"auth"}'::jsonb, '2026-04-29T19:44:05.668Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777491855534_79f30da6ba2da', 't_demo', 'super@workflowpro.be', 'tenants', 'kbo_lookup', 'BE0897225572', '{"id":"audit_1777491855534_79f30da6ba2da","at":"2026-04-29T19:44:15.534Z","actor":"super@workflowpro.be","tenantId":"t_demo","action":"kbo_lookup","area":"tenants","detail":"BE0897225572"}'::jsonb, '2026-04-29T19:44:15.534Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777509570868_11bed5f52178d8', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777509570868_11bed5f52178d8","at":"2026-04-30T00:39:30.868Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-30T00:39:30.868Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777509573795_70988031aad88', null, 'super@workflowpro.be', 'auth', 'login', '', '{"id":"audit_1777509573795_70988031aad88","at":"2026-04-30T00:39:33.795Z","actor":"super@workflowpro.be","tenantId":null,"action":"login","area":"auth"}'::jsonb, '2026-04-30T00:39:33.795Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777509575796_a2e1f7878f2598', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777509575796_a2e1f7878f2598","at":"2026-04-30T00:39:35.796Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-30T00:39:35.796Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777509589598_ff0eb65aef51f', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777509589598_ff0eb65aef51f","at":"2026-04-30T00:39:49.598Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-30T00:39:49.598Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777509590788_0a3706afb0d37', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777509590788_0a3706afb0d37","at":"2026-04-30T00:39:50.788Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-30T00:39:50.788Z')
on conflict (id) do update set data = excluded.data;

insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values ('audit_1777509591551_6d9b313145f6b', 't_demo', 'admin@demobouw.be', 'auth', 'login', '', '{"id":"audit_1777509591551_6d9b313145f6b","at":"2026-04-30T00:39:51.551Z","actor":"admin@demobouw.be","tenantId":"t_demo","action":"login","area":"auth"}'::jsonb, '2026-04-30T00:39:51.551Z')
on conflict (id) do update set data = excluded.data;

insert into global_records (collection, id, data)
values ('migrationHistory', 'migrationHistory_1', '{"version":2,"name":"account-security-defaults","appliedAt":"2026-04-30T08:02:55.322Z"}'::jsonb)
on conflict (collection, id) do update set data = excluded.data, updated_at = now();

insert into global_records (collection, id, data)
values ('migrationHistory', 'migrationHistory_2', '{"version":3,"name":"tenant-admin-production-permissions","appliedAt":"2026-04-30T08:02:55.323Z"}'::jsonb)
on conflict (collection, id) do update set data = excluded.data, updated_at = now();

insert into global_records (collection, id, data)
values ('migrationHistory', 'migrationHistory_3', '{"version":4,"name":"pilot-and-production-collections","appliedAt":"2026-04-30T08:02:55.323Z"}'::jsonb)
on conflict (collection, id) do update set data = excluded.data, updated_at = now();

insert into global_records (collection, id, data)
values ('migrationHistory', 'migrationHistory_4', '{"version":5,"name":"commercial-launch-collections","appliedAt":"2026-04-30T08:02:55.323Z"}'::jsonb)
on conflict (collection, id) do update set data = excluded.data, updated_at = now();

insert into global_records (collection, id, data)
values ('migrationHistory', 'migrationHistory_5', '{"version":6,"name":"support-escalation-notification-shape","appliedAt":"2026-04-30T08:02:55.324Z"}'::jsonb)
on conflict (collection, id) do update set data = excluded.data, updated_at = now();

commit;
