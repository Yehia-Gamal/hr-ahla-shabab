-- Production SQL Editor runner: Attendance Identity Guard patches
-- Apply after patches 001–050 and after creating the storage bucket `punch-selfies`.
-- Patch 051 creates attendance identity metadata tables and risk events.
-- Patch 052 adds review queue/RPC and storage policies.

\i patches/051_attendance_identity_verification.sql
\i patches/052_attendance_identity_server_review.sql
