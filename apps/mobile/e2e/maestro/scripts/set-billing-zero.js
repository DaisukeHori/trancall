const API_BASE = process.env.API_BASE_URL || 'http://localhost:4010';

await fetch(`${API_BASE}/api/__e2e__/set-billing-zero`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId: 'user-c-uuid-0000-0000-000000000003' }),
});
