-- Run after 001-043 and before 046+ security/workflow patches.
-- Requires app.vault_key and pg_cron configuration as documented.
\i patches/044_encrypt_credential_vault.sql
\i patches/045_enable_pg_cron_backup.sql
