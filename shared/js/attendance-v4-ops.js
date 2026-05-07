// Attendance Identity Guard V4
// Operational controls for device policy, QR station, fallback workflow, and fraud snapshot.

export async function evaluateAttendanceV4Controls({ endpoints, employee, device = {}, location = {}, risk = {} } = {}) {
  const flags = new Set();
  let requiresReview = false;
  let devicePolicy = null;
  let fraudSnapshot = null;

  try {
    devicePolicy = await endpoints?.attendanceDevicePolicyState?.({
      employeeId: employee?.id || '',
      deviceFingerprintHash: device.deviceFingerprintHash || '',
    });
    const state = devicePolicy?.data || devicePolicy || {};
    for (const flag of state.riskFlags || state.risk_flags || []) flags.add(flag);
    if (state.requiresApproval || state.requires_approval) requiresReview = true;
    if (String(state.status || '').includes('REQUIRES')) requiresReview = true;
  } catch (error) {
    console.warn('تعذر قراءة سياسة الجهاز المعتمد', error);
    flags.add('DEVICE_POLICY_CHECK_FAILED');
    requiresReview = true;
  }

  try {
    fraudSnapshot = await endpoints?.attendanceFraudOpsSnapshot?.({ days: 30 });
    const snapshot = fraudSnapshot?.data || fraudSnapshot || {};
    const devices = snapshot.deviceAbuse || snapshot.device_abuse || [];
    const hash = String(device.deviceFingerprintHash || '');
    if (hash && devices.some((row) => String(row.deviceFingerprintHash || row.device_fingerprint_hash || '') === hash)) {
      flags.add('DEVICE_ABUSE_HISTORY');
      requiresReview = true;
    }
  } catch (error) {
    console.warn('تعذر قراءة مركز مكافحة التلاعب', error);
  }

  const scoreBump = flags.has('DEVICE_LIMIT_REACHED') ? 75
    : flags.has('DEVICE_ABUSE_HISTORY') ? 70
    : flags.has('DEVICE_POLICY_CHECK_FAILED') ? 55
    : flags.has('DEVICE_APPROVAL_REQUIRED') ? 65
    : 0;

  return {
    devicePolicy,
    fraudSnapshot,
    riskFlags: Array.from(flags),
    requiresReview,
    riskScore: Math.max(Number(risk.riskScore || 0), scoreBump),
  };
}

export function mergeV4RiskSignals(baseRisk = {}, v4 = {}) {
  const flags = new Set([...(baseRisk.riskFlags || []), ...(v4.riskFlags || [])]);
  const score = Math.min(100, Math.max(Number(baseRisk.riskScore || 0), Number(v4.riskScore || 0)));
  const riskLevel = score >= 70 ? 'HIGH' : score >= 35 ? 'MEDIUM' : 'LOW';
  return {
    ...baseRisk,
    riskScore: score,
    riskLevel,
    riskFlags: Array.from(flags),
    requiresReview: Boolean(baseRisk.requiresReview || v4.requiresReview || score >= 35),
  };
}

export async function createFormalFallbackRequest({ endpoints, employee, action = 'checkIn', reason = '', location = {}, deviceFingerprintHash = '', browserInstallId = '', selfieUrl = '' } = {}) {
  if (endpoints?.createAttendanceFallbackRequest) {
    try {
      return await endpoints.createAttendanceFallbackRequest({
        employeeId: employee?.id || '',
        action,
        reason,
        deviceFingerprintHash,
        browserInstallId,
        selfieUrl,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: location.accuracyMeters ?? location.accuracy,
      });
    } catch (error) {
      console.warn('تعذر إنشاء طلب حضور احتياطي رسمي؛ سيتم استخدام مسار الرفض القديم', error);
    }
  }
  return { ok: false, fallbackToLegacy: true };
}

export function buildRiskReportCsv(rows = []) {
  const header = ['الموظف','الدرجة','المستوى','الأسباب','آخر ظهور'];
  const body = rows.map((row) => [
    row.employeeName || row.employee?.fullName || row.employeeId || '',
    row.score ?? row.riskScore ?? '',
    row.level ?? row.riskLevel ?? '',
    (row.flags || row.riskFlags || []).map((f) => f.label || f).join(' | '),
    row.lastSeenAt || row.eventAt || row.createdAt || '',
  ]);
  return [header, ...body].map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}
