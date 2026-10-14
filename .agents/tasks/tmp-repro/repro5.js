'use strict';
// node repro5.js <base>  : raw HTTP view of caching right after reserve
(async () => {
    const base = process.argv[2];
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'u', password: 'p' }) });
    const cookie = (login.headers.getSetCookie() || []).map(c => c.split(';')[0]).join('; ');
    const get = async (p, h = {}) => {
        const r = await fetch(base + p, { headers: Object.assign({ cookie }, h) });
        const body = r.status === 304 ? null : await r.json();
        return { r, body };
    };
    const state = (body) => {
        const arr = Array.isArray(body) ? body : body.presents;
        return arr.filter(p => p.id === 3).map(p => `p3.reserved_by=${p.reserved_by} user=${p.reserved_by_username}`).join('');
    };
    let a = await get('/api/recipients-with-presents');
    console.log('combined #1', a.r.status, 'etag=', a.r.headers.get('etag'), 'cache-control=', a.r.headers.get('cache-control'), state(a.body));
    const post = await fetch(base + '/api/presents/3/reserve', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' } });
    console.log('POST reserve', post.status, JSON.stringify(await post.json()));
    let b = await get('/api/recipients-with-presents', { 'If-None-Match': a.r.headers.get('etag') });
    console.log('combined #2 (If-None-Match old etag)', b.r.status, 'etag=', b.r.headers.get('etag'), b.body ? state(b.body) : '(304 - stale!)');
    let c = await get('/api/presents/all');
    console.log('presents/all', c.r.status, state(c.body));
    let d = await get('/api/presents');
    console.log('presents', d.r.status, state(d.body));
    const dup = await fetch(base + '/api/presents/3/reserve', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' } });
    console.log('POST reserve again', dup.status, JSON.stringify(await dup.json()));
    const del = await fetch(base + '/api/presents/3/reserve', { method: 'DELETE', headers: { cookie } });
    console.log('DELETE reserve', del.status, JSON.stringify(await del.json()));
    let e = await get('/api/recipients-with-presents');
    console.log('combined after DELETE', e.r.status, state(e.body));
    const upd = await get('/api/updates?since=0');
    console.log('updates', upd.r.status, JSON.stringify(upd.body).slice(0, 200));
})().catch(e => { console.error('FAIL', e); process.exit(1); });
