const API_BASE = process.env.API_BASE_URL || 'http://localhost:4010';

await fetch(`${API_BASE}/api/__e2e__/reset`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
});
