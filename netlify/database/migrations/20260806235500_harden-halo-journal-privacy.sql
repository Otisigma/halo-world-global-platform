UPDATE halo_journal_events
SET details = COALESCE((
  SELECT jsonb_object_agg(
    key,
    CASE
      WHEN jsonb_typeof(value) = 'string' THEN to_jsonb(
        regexp_replace(
          value #>> '{}',
          '(?i)(\m([0-9]{1,3}\.){3}[0-9]{1,3}\M|\m([a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}\M)',
          '[private network address]',
          'g'
        )
      )
      ELSE value
    END
  )
  FROM jsonb_each(details)
  WHERE key !~* '(^|_)(ip|ipv4|ipv6|client_ip|remote_address|forwarded_for|x_forwarded_for)($|_)'
), '{}'::jsonb)
WHERE details <> '{}'::jsonb;
