'use strict';
// node run.js <worktreeDir> <port> <mode>  -> boots demo server, runs repro.js, kills server, prints server log tail
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const [wt, port, mode] = process.argv.slice(2);
const env = Object.assign({}, process.env, { PORT: port, DEMO_MODE: 'true', NODE_ENV: 'development', HOST: '127.0.0.1' });
delete env.DB_PASSWORD;
const child = spawn(process.execPath, ['server.js'], { cwd: wt, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = '';
child.stdout.on('data', b => { log += b; });
child.stderr.on('data', b => { log += b; });
(async () => {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) {
        try { const r = await fetch(base + '/health'); if (r.ok) break; } catch (e) {}
        await new Promise(r => setTimeout(r, 200));
    }
    const res = spawnSync(process.execPath, (mode === 'r5' ? [path.join(__dirname, 'repro5.js'), base] : mode === 'r4' ? [path.join(__dirname, 'repro4.js'), base] : mode === 'r3' ? [path.join(__dirname, 'repro3.js'), base] : isNaN(mode) ? [path.join(__dirname, 'repro.js'), base, mode] : [path.join(__dirname, 'repro2.js'), base, mode]), { stdio: 'inherit', timeout: 100000 });
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    const lines = log.split('\n').filter(l => /reserve|Reserve|Cache|present/i.test(l)).slice(-25);
    console.log('--- SERVER LOG (filtered) ---\n' + lines.join('\n'));
})();
