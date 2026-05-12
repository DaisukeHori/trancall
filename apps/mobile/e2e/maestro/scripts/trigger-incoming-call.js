const API_BASE = process.env.API_BASE_URL || 'http://localhost:4010';

const response = await fetch(`${API_BASE}/api/__e2e__/trigger-incoming-call`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ targetUserId: 'user-a-uuid-0000-0000-000000000001' }),
});

const data = await response.json();
output.deepLink = data.data?.deepLink ?? '';
output.roomId = data.data?.roomId ?? '';
