create table if not exists app_schema_migrations (
  version integer primary key,
  name text not null,
  applied_at timestamptz not null default now()
);

create table if not exists tenants (
  id text primary key,
  name text not null,
  plan text not null default 'business',
  status text not null default 'trial',
  billing_email text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tenant_records (
  collection text not null,
  id text not null,
  tenant_id text references tenants(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create table if not exists global_records (
  collection text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create table if not exists audit_logs (
  id text primary key,
  tenant_id text references tenants(id) on delete set null,
  actor text,
  area text not null,
  action text not null,
  detail text,
  data jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create table if not exists error_events (
  id text primary key,
  tenant_id text references tenants(id) on delete set null,
  status integer,
  method text,
  path text,
  message text,
  data jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

create index if not exists tenant_records_tenant_collection_idx on tenant_records (tenant_id, collection);
create index if not exists tenant_records_collection_idx on tenant_records (collection);
create index if not exists tenant_records_data_gin_idx on tenant_records using gin (data);
create index if not exists audit_logs_tenant_at_idx on audit_logs (tenant_id, at desc);
create index if not exists audit_logs_area_action_idx on audit_logs (area, action);
create index if not exists error_events_tenant_at_idx on error_events (tenant_id, at desc);

insert into app_schema_migrations (version, name)
values (1, 'supabase-core-schema')
on conflict (version) do nothing;
