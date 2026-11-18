-- AURA v0.7.1. Черновик для ревью, вне автоматических миграций.
-- После отдельного согласования сначала установить политики, затем создать новый
-- закрытый staff-avatars через Storage Dashboard или API. См. соседний план.

begin;

do $review$
begin
  if not exists (
    select 1
    from pg_class as relation
    where relation.oid = to_regclass('storage.objects')
      and relation.relrowsecurity
  ) then
    raise exception 'Expected RLS to be enabled on storage.objects';
  end if;

  if to_regprocedure('storage.allow_any_operation(text[])') is null then
    raise exception 'Expected the Storage operation-aware RLS helper';
  end if;

  if exists (
    select 1 from storage.buckets
    where id = 'staff-avatars' or name = 'staff-avatars'
  ) then
    raise exception 'Expected a new bucket. Review the existing staff-avatars first';
  end if;
end;
$review$;

-- Предоставляет доступ к единственному каноническому объекту владельца.
-- USING применяется к существующей строке, WITH CHECK к записываемой.
create policy aura_staff_avatars_owner
  on storage.objects
  as permissive
  for all
  to authenticated
  using (
    bucket_id = 'staff-avatars'
    and owner_id = (select auth.uid()::text)
    and name = (select auth.uid()::text) || '/avatar.webp'
    and (select auth.jwt() ->> 'is_anonymous') = 'false'
  )
  with check (
    bucket_id = 'staff-avatars'
    and owner_id = (select auth.uid()::text)
    and name = (select auth.uid()::text) || '/avatar.webp'
    and (select auth.jwt() ->> 'is_anonymous') = 'false'
  );

-- Ограничение действует на любые применимые разрешающие политики Storage.
-- Для остальных bucket оно истинно и сохраняет действие их прежних правил.
create policy aura_staff_avatars_boundary
  on storage.objects
  as restrictive
  for all
  to public
  using (
    bucket_id is distinct from 'staff-avatars'
    or (
      owner_id = (select auth.uid()::text)
      and name = (select auth.uid()::text) || '/avatar.webp'
      and (select auth.jwt() ->> 'is_anonymous') = 'false'
      and (select storage.allow_any_operation(array[
        'object.get_authenticated',
        'object.upload',
        'object.delete_many'
      ]))
    )
  )
  with check (
    bucket_id is distinct from 'staff-avatars'
    or (
      owner_id = (select auth.uid()::text)
      and name = (select auth.uid()::text) || '/avatar.webp'
      and (select auth.jwt() ->> 'is_anonymous') = 'false'
      and (select storage.allow_any_operation(array['object.upload']))
    )
  );

commit;
