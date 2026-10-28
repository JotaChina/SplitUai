-- The bundled Supabase pg_net extension exposes its routines in schema net.
revoke all on function net.http_get(text, jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function net.http_post(text, jsonb, jsonb, jsonb, integer) from public, anon, authenticated;
