-- Production SQL bundle: Identity Guard + Full Workflow Notes + Final QA patches
-- Run after the base system patches 001-050 have been applied.

\i patches/051_attendance_identity_verification.sql
\i patches/052_attendance_identity_server_review.sql
\i patches/053_trusted_device_approval.sql
\i patches/054_attendance_branch_qr_challenge.sql
\i patches/055_attendance_anti_spoofing_risk.sql
\i patches/056_attendance_risk_center.sql
\i patches/057_employee_requests_two_stage_workflow.sql
\i patches/058_kpi_advanced_workflow_percentages.sql
\i patches/059_dispute_committee_privacy_workflow.sql
\i patches/060_location_readable_labels_and_policy_ack.sql
\i patches/061_trusted_device_policy_enforcement.sql
\i patches/062_branch_qr_station_rotation.sql
\i patches/063_attendance_fraud_ops_snapshot.sql
\i patches/064_attendance_fallback_workflow.sql
