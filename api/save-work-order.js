const API_VERSION = '2026-03-10';

function cors(req, res) {
  const configured = process.env.ALLOWED_ORIGIN || '';
  const origin = req.headers.origin || '';
  if (configured && configured !== '*' && origin && origin !== configured) {
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', configured || origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return true;
}

function parseBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body);
  return req.body || {};
}

function dataUrlToBase64(value, expectedPrefix) {
  if (typeof value !== 'string' || !value.startsWith(expectedPrefix)) {
    throw new Error(`Missing or invalid ${expectedPrefix.includes('png') ? 'signature' : 'photo'} data.`);
  }
  const comma = value.indexOf(',');
  if (comma < 0) throw new Error('Malformed image data.');
  return value.slice(comma + 1);
}

function makeWorkOrderId() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `WO-${stamp}-${rand}`;
}

async function gh(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('Server is missing GITHUB_TOKEN.');
  const r = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  let body = null;
  try { body = await r.json(); } catch (_) {}
  if (!r.ok) {
    const message = body && body.message ? body.message : `GitHub API error ${r.status}`;
    const err = new Error(message);
    err.status = r.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function createBlob(owner, repo, base64) {
  const out = await gh(`/repos/${owner}/${repo}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: base64, encoding: 'base64' })
  });
  return out.sha;
}

async function createCommit(owner, repo, branch, files, message) {
  // Files is [{path, sha}]. Retry once if another request advances the branch.
  for (let attempt = 0; attempt < 2; attempt++) {
    const ref = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    const headSha = ref.object.sha;
    const parentCommit = await gh(`/repos/${owner}/${repo}/git/commits/${headSha}`);

    const tree = await gh(`/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: parentCommit.tree.sha,
        tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', sha: f.sha }))
      })
    });

    const commit = await gh(`/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] })
    });

    try {
      await gh(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false })
      });
      return commit;
    } catch (e) {
      if (attempt === 1 || (e.status !== 409 && e.status !== 422)) throw e;
    }
  }
}

export default async function handler(req, res) {
  if (!cors(req, res)) {
    return res.status(403).json({ error: 'This origin is not allowed.' });
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  try {
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || 'main';
    if (!owner || !repo) throw new Error('Server is missing GITHUB_OWNER or GITHUB_REPO.');

    const b = parseBody(req);
    const workOrderId = makeWorkOrderId();
    const folder = `maintenance-orders/${workOrderId}`;

    const preBase64 = dataUrlToBase64(b.pre_photo, 'data:image/jpeg;base64,');
    const postBase64 = dataUrlToBase64(b.post_photo, 'data:image/jpeg;base64,');
    const sigBase64 = dataUrlToBase64(b.signature, 'data:image/png;base64,');

    const order = {
      work_order_id: workOrderId,
      property_unit: b.property_unit || '',
      tenant_name: b.tenant_name || '',
      maintenance_request: b.maintenance_request || '',
      notes: b.notes || '',
      completed_at: b.completed_at || new Date().toISOString(),
      files: {
        before_photo: 'before.jpg',
        after_photo: 'after.jpg',
        tenant_signature: 'signature.png'
      }
    };

    const orderBase64 = Buffer.from(JSON.stringify(order, null, 2), 'utf8').toString('base64');
    const [orderSha, preSha, postSha, sigSha] = await Promise.all([
      createBlob(owner, repo, orderBase64),
      createBlob(owner, repo, preBase64),
      createBlob(owner, repo, postBase64),
      createBlob(owner, repo, sigBase64)
    ]);

    const commit = await createCommit(owner, repo, branch, [
      { path: `${folder}/order.json`, sha: orderSha },
      { path: `${folder}/before.jpg`, sha: preSha },
      { path: `${folder}/after.jpg`, sha: postSha },
      { path: `${folder}/signature.png`, sha: sigSha }
    ], `Add maintenance work order ${workOrderId}`);

    return res.status(201).json({
      ok: true,
      work_order_id: workOrderId,
      folder,
      commit_sha: commit.sha,
      commit_url: `https://github.com/${owner}/${repo}/commit/${commit.sha}`
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Could not save work order.' });
  }
}
