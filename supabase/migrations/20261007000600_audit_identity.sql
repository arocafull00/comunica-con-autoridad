-- Preserve a readable actor identity for configuration history.
alter table public.admin_audit add column actor_email text;
create function private.capture_admin_audit_actor() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select email into new.actor_email from auth.users where id=new.actor_id;
  return new;
end;
$$;
revoke all on function private.capture_admin_audit_actor() from public, anon, authenticated;
create trigger capture_admin_audit_actor before insert on public.admin_audit
for each row execute function private.capture_admin_audit_actor();
