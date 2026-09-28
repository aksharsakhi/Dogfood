export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const escaped: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return escaped[character] ?? character;
  });
}

export function certificateHtml(title: string, content: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
*{box-sizing:border-box}body{margin:0;padding:3rem 1rem;background:#f7f8f3;color:#182b24;font:16px/1.6 system-ui,sans-serif}
main{max-width:850px;margin:0 auto;padding:3rem;background:#fff;border:1px solid #dce2d8;border-radius:12px}
.eyebrow{color:#446748;font-weight:700;letter-spacing:.08em;text-transform:uppercase}h1{font-size:2.4rem;line-height:1.1}dt{font-weight:700;margin-top:1rem}dd{margin:0;overflow-wrap:anywhere}p{max-width:680px}.print{margin-top:2rem;padding:.7rem 1rem;background:#225f40;color:white;border:0;border-radius:5px;font:inherit;cursor:pointer}
@media print{body{padding:0;background:#fff}main{max-width:none;border:0;border-radius:0;padding:1cm}.print{display:none}}
</style></head><body><main><p class="eyebrow">DogFood participation record</p>${content}<button class="print" onclick="window.print()">Print / Save as PDF</button></main></body></html>`;
}

export function registrationCertificate(input: {
  eventName: string;
  eventId: string;
  displayName: string;
  status: string;
  registeredAt: Date;
}): string {
  return certificateHtml(
    'Event registration record',
    `<h1>Event registration</h1><p>This record confirms that DogFood account <strong>${escapeHtml(input.displayName)}</strong> had a registration record for <strong>${escapeHtml(input.eventName)}</strong>.</p><dl><dt>Registration status</dt><dd>${escapeHtml(input.status)}</dd><dt>Registration recorded</dt><dd>${escapeHtml(input.registeredAt.toISOString())}</dd><dt>Event identifier</dt><dd><code>${escapeHtml(input.eventId)}</code></dd></dl><p>This record describes platform data only. It does not establish physical presence, a competitive outcome, or the real-world identity of an account holder.</p>`,
  );
}

export function projectCertificate(input: {
  eventName: string;
  eventId: string;
  projectName: string;
  teamName: string;
  snapshotTitle: string;
  snapshotDescription: string;
  repositoryUrl: string | null;
  submittedAt: Date;
  accountLabel: string;
}): string {
  const repo = input.repositoryUrl
    ? `<dt>Repository URL in submitted snapshot</dt><dd>${escapeHtml(input.repositoryUrl)}</dd>`
    : '';
  return certificateHtml(
    'Team and project participation record',
    `<h1>Team and project participation</h1><p>This record confirms that DogFood account <strong>${escapeHtml(input.accountLabel)}</strong> had a team membership associated with a submitted project snapshot in <strong>${escapeHtml(input.eventName)}</strong>.</p><dl><dt>Team</dt><dd>${escapeHtml(input.teamName)}</dd><dt>Project</dt><dd>${escapeHtml(input.projectName)}</dd><dt>Submitted snapshot title</dt><dd>${escapeHtml(input.snapshotTitle)}</dd><dt>Submitted snapshot description</dt><dd>${escapeHtml(input.snapshotDescription)}</dd>${repo}<dt>Snapshot submitted</dt><dd>${escapeHtml(input.submittedAt.toISOString())}</dd><dt>Event identifier</dt><dd><code>${escapeHtml(input.eventId)}</code></dd></dl><p>This record describes stored team membership and submission data only. It does not establish physical presence, a competitive outcome, or the real-world identity of an account holder.</p>`,
  );
}

export function judgeRecordCertificate(input: {
  recordId: string;
  payload: Record<string, string | number>;
  canonicalPayload: string;
  signature: string;
  publicKeyPem: string;
  fingerprint: string;
  status: string;
  supersededByRecordId?: string;
  revokedAt?: string;
}): string {
  const items = Object.entries(input.payload)
    .map(
      ([key, value]) =>
        `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd>`,
    )
    .join('');
  const statusDetails = input.revokedAt
    ? `<p>Revoked at ${escapeHtml(input.revokedAt)}.</p>`
    : input.supersededByRecordId
      ? `<p>Superseded by record <code>${escapeHtml(input.supersededByRecordId)}</code>.</p>`
      : '';
  return certificateHtml(
    'Signed judge participation record',
    `<h1>Signed judge participation record</h1><p>Cryptographic signature status: <strong>${escapeHtml(input.status)}</strong>.</p>${statusDetails}<dl><dt>Record identifier</dt><dd><code>${escapeHtml(input.recordId)}</code></dd>${items}<dt>Canonical payload JSON (the exact signed UTF-8 bytes)</dt><dd><code>${escapeHtml(input.canonicalPayload)}</code></dd><dt>Public key fingerprint (SHA-256 of raw Ed25519 public key)</dt><dd><code>${escapeHtml(input.fingerprint)}</code></dd><dt>Public key (PEM)</dt><dd><code>${escapeHtml(input.publicKeyPem)}</code></dd><dt>Ed25519 signature (base64url)</dt><dd><code>${escapeHtml(input.signature)}</code></dd></dl><p>Anyone can verify this signature offline with the public key and canonical payload. Signature validity does not by itself establish which installation controls the key.</p>`,
  );
}
