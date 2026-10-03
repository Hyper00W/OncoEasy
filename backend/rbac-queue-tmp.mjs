const BASE = 'http://localhost:3016';
async function probe(token, path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  await res.text().catch(() => '');
  return res.status;
}
async function main() {
  const tokens = {};
  for (const line of process.env.LINES.split('\n')) {
    const i = line.indexOf('=');
    tokens[line.slice(0, i)] = line.slice(i + 1);
  }
  const out = {};
  out.PATIENT = await probe(tokens.PATIENT, '/api/v1/pharmacy/prescriptions/review-queue');
  out.DOCTOR = await probe(tokens.DOCTOR, '/api/v1/pharmacy/prescriptions/review-queue');
  out.PHARMACIST = await probe(tokens.PHARMACIST, '/api/v1/pharmacy/prescriptions/review-queue');
  out.OPS_ADMIN = await probe(tokens.OPS_ADMIN, '/api/v1/pharmacy/prescriptions/review-queue');
  out.NO_AUTH = await probe('', '/api/v1/pharmacy/prescriptions/review-queue');
  console.log(JSON.stringify(out));
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
