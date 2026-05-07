-- WorkFlow Pro production target schema
-- PostgreSQL / Supabase-ready baseline.

create extension if not exists "uuid-ossp";

create table tenants (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  plan text not null default 'business',
  status text not null default 'trial',
  billing_email text,
  invoice_profile jsonb not null default '{}',
  onboarding jsonb not null default '{}',
  support_access jsonb not null default '{}',
  billing_ops jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid references tenants(id) on delete cascade,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null,
  permissions jsonb not null default '[]',
  mfa_enabled boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table roles (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  permissions jsonb not null default '[]',
  action_permissions jsonb not null default '[]',
  venue_scope jsonb not null default '[]',
  sensitivity text not null default 'internal',
  locked boolean not null default false
);

create table venues (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  code text,
  address text,
  active boolean not null default true
);

create table customers (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  vat text,
  email text,
  phone text,
  contact jsonb not null default '{}',
  address jsonb not null default '{}',
  payment_terms text,
  status text not null default 'active'
);

create table shifts (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid references users(id),
  venue_id uuid references venues(id),
  date date not null,
  starts_at time not null,
  ends_at time not null,
  type text,
  project text,
  client text,
  billable boolean not null default false,
  note text
);

create table clocks (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid references users(id),
  venue_id uuid references venues(id),
  date date not null,
  clock_in time not null,
  clock_out time
);

create table workorders (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid references users(id),
  venue_id uuid references venues(id),
  customer_id uuid references customers(id),
  title text not null,
  status text not null default 'Bezig',
  description text,
  checklist jsonb not null default '[]',
  materials jsonb not null default '[]',
  files jsonb not null default '[]',
  signed boolean not null default false,
  reviewed boolean not null default false,
  billable_hours numeric(8,2) not null default 0
);

create table expenses (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid references users(id),
  venue_id uuid references venues(id),
  title text not null,
  amount numeric(12,2) not null,
  category text not null,
  status text not null default 'submitted',
  receipt_file_id uuid,
  billable boolean not null default false
);

create table stock_items (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  venue_id uuid references venues(id),
  name text not null,
  sku text,
  qty numeric(12,2) not null default 0,
  min_qty numeric(12,2) not null default 0,
  unit text not null default 'st'
);

create table vehicles (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  venue_id uuid references venues(id),
  plate text not null,
  brand text,
  status text not null default 'Beschikbaar',
  assigned_to uuid references users(id),
  next_service date
);

create table leaves (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid references users(id),
  starts_on date not null,
  ends_on date not null,
  type text,
  status text not null default 'In behandeling'
);

create table messages (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  from_user_id uuid references users(id),
  to_user_id uuid references users(id),
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table integrations (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null,
  status text not null default 'disconnected',
  config jsonb not null default '{}',
  encrypted_secret text,
  last_sync_at timestamptz,
  last_error text
);

create table invoices (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  invoice_number text not null,
  status text not null default 'draft',
  peppol_status text not null default 'missing_peppol',
  amount numeric(12,2) not null,
  due_date date,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table payment_methods (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  provider text not null default 'stripe',
  provider_ref text not null,
  label text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid references tenants(id),
  actor_user_id uuid references users(id),
  actor_email text,
  area text not null,
  action text not null,
  detail text,
  old_value jsonb,
  new_value jsonb,
  ip text,
  device text,
  created_at timestamptz not null default now()
);

alter table tenants enable row level security;
alter table users enable row level security;
alter table roles enable row level security;
alter table venues enable row level security;
alter table customers enable row level security;
alter table shifts enable row level security;
alter table clocks enable row level security;
alter table workorders enable row level security;
alter table expenses enable row level security;
alter table stock_items enable row level security;
alter table vehicles enable row level security;
alter table leaves enable row level security;
alter table messages enable row level security;
alter table integrations enable row level security;
alter table invoices enable row level security;
alter table payment_methods enable row level security;
alter table audit_logs enable row level security;
