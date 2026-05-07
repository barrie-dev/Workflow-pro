alter table tenants enable row level security;
alter table tenant_records enable row level security;
alter table global_records enable row level security;
alter table audit_logs enable row level security;
alter table error_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'tenants' and policyname = 'service_role_all_tenants') then
    create policy service_role_all_tenants on tenants for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'tenant_records' and policyname = 'service_role_all_tenant_records') then
    create policy service_role_all_tenant_records on tenant_records for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'global_records' and policyname = 'service_role_all_global_records') then
    create policy service_role_all_global_records on global_records for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'audit_logs' and policyname = 'service_role_all_audit_logs') then
    create policy service_role_all_audit_logs on audit_logs for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'error_events' and policyname = 'service_role_all_error_events') then
    create policy service_role_all_error_events on error_events for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

insert into app_schema_migrations (version, name)
values (2, 'supabase-row-level-security')
on conflict (version) do nothing;
