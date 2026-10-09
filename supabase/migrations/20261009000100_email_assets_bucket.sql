-- Public campaign photography. Only the server service role may upload or modify files;
-- public downloads do not require a Storage SELECT policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('email-assets', 'email-assets', true, 1048576, array['image/jpeg'])
on conflict (id) do nothing;
