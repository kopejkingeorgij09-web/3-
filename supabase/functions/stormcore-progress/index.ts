const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Cache-Control': 'no-store',
};
const codePattern = /^[a-z0-9]{3,16}(?:-[a-hj-km-np-z2-9]{5}){4}$/;

function reply(status: number, data: Record<string, unknown>) {
  return Response.json(data, { status, headers });
}

async function parse(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 8192) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(part.value, { stream: true });
    }
    const value = JSON.parse(body + decoder.decode());
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function bounded(value: unknown, max: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null,{ status: 204, headers });
  if (request.method !== 'POST') return reply(405,{ error: 'method' });
  const data = await parse(request);
  if (!data) return reply(400,{ error: 'body' });
  const { action, code } = data;
  const versioned = data.campaign === 2;
  const actions = versioned ? ['load','create','save','buy'] : ['load','create','save'];
  if (!actions.includes(action) ||
      typeof code !== 'string' || !codePattern.test(code)) {
    return reply(400,{ error: 'code' });
  }
  const cleared = action === 'load' ? 0 : data.cleared;
  const best = action === 'load' ? 0 : data.best;
  if (!bounded(cleared,versioned ? 24 : 12) || !bounded(best,1000000000)) return reply(400,{ error: 'progress' });
  let path = 'stormcore_exchange_progress';
  const payload: Record<string, unknown> = {
    code_hash:'',command:action,incoming_cleared:cleared,incoming_best:best
  };
  if (versioned) {
    const flights = data.flights ?? [];
    const owned = data.owned ?? [0];
    const credits = data.credits ?? 0;
    const flightId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
    if (!Array.isArray(flights) || flights.length > 40 ||
        !flights.every(flight=>flight && typeof flight.id === 'string' && flightId.test(flight.id) &&
          bounded(flight.amount,100000) && flight.amount > 0) ||
        !Array.isArray(owned) || owned.length > 10 || !owned.every(ship=>bounded(ship,9)) ||
        !bounded(credits,1000000000) ||
        (action === 'buy' && (!bounded(data.purchase,9) || data.purchase === 0))) {
      return reply(400,{error:'campaign'});
    }
    path = 'stormcore_exchange_campaign';
    Object.assign(payload,{
      flight_awards:flights,purchase:action === 'buy' ? data.purchase : null,
      initial_credits:credits,initial_owned:owned
    });
  }
  const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code));
  const key = [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  payload.code_hash = key;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const url = Deno.env.get('SUPABASE_URL');
  if (!serviceKey || !url) return reply(503,{ error: 'unavailable' });
  try {
    const db = await fetch(url+'/rest/v1/rpc/'+path,{
      method:'POST',
      headers:{ 'Content-Type':'application/json', apikey:serviceKey, Authorization:'Bearer '+serviceKey },
      body:JSON.stringify(payload),
      signal:AbortSignal.timeout(5500)
    });
    if (!db.ok) return reply(503,{ error: 'unavailable' });
    const [row] = await db.json();
    if (!row) return reply(404,{ error: 'missing' });
    return reply(200,versioned ? row : { cleared:row.cleared,best:row.best });
  } catch {
    return reply(503,{ error: 'unavailable' });
  }
});
