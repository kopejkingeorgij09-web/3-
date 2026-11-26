const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Cache-Control': 'no-store',
};
const codePattern = /^[a-z0-9]{3,16}(?:-[a-hj-km-np-z2-9]{5}){4}$/;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const upgrades = ['engine','armor','weapon'];

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

function validTuning(value: unknown, owned: number[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 18 && entries.every(([ship, parts]) =>
    /^(?:[0-9]|1[0-7])$/.test(ship) && (ship === '0' || owned.includes(Number(ship))) &&
    parts && typeof parts === 'object' && !Array.isArray(parts) &&
    Object.entries(parts).every(([part,tier])=>upgrades.includes(part) && bounded(tier,3)));
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null,{ status: 204, headers });
  if (request.method !== 'POST') return reply(405,{ error: 'method' });
  const data = await parse(request);
  if (!data) return reply(400,{ error: 'body' });
  const { action, code } = data;
  const protocol = data.campaign === 3 ? 3 : data.campaign === 2 ? 2 : 1;
  const actions = ['load','create','save'];
  if (protocol >= 2) actions.push('buy');
  if (protocol === 3) actions.push('favorite','tune','reset','restore');
  if (!actions.includes(action) ||
      typeof code !== 'string' || !codePattern.test(code)) {
    return reply(400,{ error: 'code' });
  }
  const cleared = action === 'load' ? 0 : data.cleared;
  const best = action === 'load' ? 0 : data.best;
  if (!bounded(cleared,protocol === 1 ? 12 : 24) || !bounded(best,1000000000)) return reply(400,{ error: 'progress' });
  let path = 'stormcore_exchange_progress';
  let payload: Record<string, unknown> = {
    code_hash:'',command:action,incoming_cleared:cleared,incoming_best:best
  };
  if (protocol >= 2) {
    const flights = data.flights ?? [];
    const owned = data.owned ?? [0];
    const credits = data.credits ?? 0;
    const max = protocol === 3 ? 17 : 9;
    if (!Array.isArray(flights) || flights.length > 40 ||
        !flights.every(flight=>flight && typeof flight.id === 'string' && uuid.test(flight.id) &&
          bounded(flight.amount,100000) && flight.amount > 0) ||
        !Array.isArray(owned) || owned.length > max+1 || !owned.every(ship=>bounded(ship,max)) ||
        !bounded(credits,1000000000)) {
      return reply(400,{error:'campaign'});
    }
    if (protocol === 2) {
      if (action === 'buy' && (!bounded(data.purchase,9) || data.purchase === 0)) {
        return reply(400,{error:'campaign'});
      }
      path = 'stormcore_exchange_campaign';
      Object.assign(payload,{
        flight_awards:flights,purchase:action === 'buy' ? data.purchase : null,
        initial_credits:credits,initial_owned:owned
      });
    } else {
      const {epoch,ship,tuningKind,expectedTier,transition} = data;
      const tuning = data.tuning ?? {};
      const favorite = data.favorite ?? null;
      if (!bounded(epoch,2147483647) ||
          (action === 'buy' && (!bounded(ship,max) || ship === 0)) ||
          (action === 'favorite' && ship != null && !bounded(ship,max)) ||
          (action === 'tune' && (!bounded(ship,max) || !upgrades.includes(tuningKind) || !bounded(expectedTier,2))) ||
          (['reset','restore'].includes(action) && (typeof transition !== 'string' || !uuid.test(transition))) ||
          (favorite !== null && !bounded(favorite,max)) || !validTuning(tuning,owned)) {
        return reply(400,{error:'workshop'});
      }
      path = 'stormcore_exchange_campaign_v3';
      payload = {code_hash:'',payload:{
        action,cleared,best,epoch,flights,
        ship: ['buy','favorite','tune'].includes(action) ? ship ?? null : null,
        tuningKind: action === 'tune' ? tuningKind : null,
        expectedTier: action === 'tune' ? expectedTier : null,
        transition: ['reset','restore'].includes(action) ? transition : null,
        credits,owned,favorite,tuning
      }};
    }
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
    if (!db.ok) {
      const {code} = await db.json().catch(()=>({code:undefined}));
      if (code === 'ST001') return reply(409,{error:'update_required'});
      return reply(503,{ error: 'unavailable' });
    }
    const [row] = await db.json();
    if (!row) return reply(404,{ error: 'missing' });
    return reply(200,protocol >= 2 ? row : { cleared:row.cleared,best:row.best });
  } catch {
    return reply(503,{ error: 'unavailable' });
  }
});
