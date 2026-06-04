// Shared state for The Alpha Odyssey board, backed by Vercel KV / Upstash Redis.
// GET  -> returns the shared state object.
// POST {ops:[...]} -> applies granular ops (server-side merge), returns the new state.
//
// Falls back to HTTP 503 when no KV is configured, so the static page keeps
// working in local-only (per-browser) mode until a KV store is connected.

const KV_URL   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const RKEY = 'summer-nyc:state:v1';

function blank(){
  return { toteOwners:{}, packed:{}, itemHL:{}, itemNote:{}, devices:[], deviceDone:{}, deviceCount:{}, devSeeded:false };
}

async function redis(args){
  const res = await fetch(KV_URL, {
    method:'POST',
    headers:{ Authorization:'Bearer '+KV_TOKEN, 'Content-Type':'application/json' },
    body: JSON.stringify(args)
  });
  if(!res.ok) throw new Error('KV '+res.status);
  const j = await res.json();
  return j.result;
}

async function getState(){
  const raw = await redis(['GET', RKEY]);
  if(!raw) return blank();
  try { return Object.assign(blank(), JSON.parse(raw)); } catch(e){ return blank(); }
}
async function setState(s){ await redis(['SET', RKEY, JSON.stringify(s)]); }

// op forms:
//   {field, key, value}        -> set state[field][key] = value
//   {field, key, value:null}   -> delete state[field][key]
//   {field, value}             -> replace state[field] wholesale (arrays / scalars)
function applyOp(s, op){
  if(!op || !op.field) return;
  if(op.key === undefined || op.key === null){ s[op.field] = op.value; return; }
  if(typeof s[op.field] !== 'object' || s[op.field] === null || Array.isArray(s[op.field])) s[op.field] = {};
  if(op.value === undefined || op.value === null) delete s[op.field][op.key];
  else s[op.field][op.key] = op.value;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if(!KV_URL || !KV_TOKEN){ res.status(503).json({ error:'KV not configured' }); return; }
  try {
    if(req.method === 'GET'){
      res.status(200).json(await getState());
      return;
    }
    if(req.method === 'POST'){
      const body = (req.body && typeof req.body === 'object') ? req.body : JSON.parse(req.body || '{}');
      const ops = Array.isArray(body.ops) ? body.ops : [];
      const s = await getState();
      ops.forEach(op => applyOp(s, op));
      await setState(s);
      res.status(200).json(s);
      return;
    }
    res.status(405).json({ error:'Method not allowed' });
  } catch(e){
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
