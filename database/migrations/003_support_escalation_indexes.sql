create index if not exists tenant_records_notification_source_ref_idx
on tenant_records ((data->>'sourceRef'))
where collection = 'notifications' and data ? 'sourceRef';

create index if not exists tenant_records_support_status_priority_idx
on tenant_records ((data->>'status'), (data->>'priority'), (data->>'category'))
where collection = 'supportTickets';

insert into app_schema_migrations (version, name)
values (3, 'support-escalation-indexes')
on conflict (version) do nothing;
