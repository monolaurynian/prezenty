'use strict';
/**
 * Boots the REAL server.js as a child process in demo mode, on a free
 * ephemeral port, and resolves once /health reports mode === 'DEMO'.
 *
 * Why a child process and not `require('../server')`:
 *  - server.js calls startServer() at require time and process.exit(1) on a
 *    listen error, so it must not share the test runner's process;
 *  - a child lets us set OFFLINE_MODE / PORT / NODE_ENV without mutating the
 *    runner's own environment (and without a cross-env dependency);
 *  - it is the same process the user runs with `npm start`, so the suite
 *    exercises the shipped boot path.
 *
 * Env set on the child (see server.js:83-86, 452-466, 404-405):
 *  OFFLINE_MODE=true   - forces DEMO_MODE on even if a developer's .env has
 *                        DB_PASSWORD set (that would otherwise disable it)
 *  NODE_ENV=development- keeps the session cookie non-Secure so login works
 *                        over plain HTTP
 *  HOST=127.0.0.1      - keeps the test server off the LAN
 *  PORT=<free>         - never collides with a dev server on 3002
 *  SESSION_SECRET      - fixed, so the boot log is unambiguous
 *  DB_PASSWORD deleted - belt and braces with OFFLINE_MODE
 */

const { spawn, spawnSync } = require('child_process');
const net = require('net');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HEALTH_TIMEOUT_MS = 30000;
const HEALTH_POLL_MS = 150;
const MAX_LOG_BYTES = 64 * 1024;

/** Ask the OS for a free port, then release it. */
function findFreePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.unref();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Kill the whole process tree. On Windows child.kill() only kills the direct
 * child, which can leave the listener holding the port; taskkill /T handles
 * the tree. Idempotent - safe to call from teardown AND from process exit.
 */
function killTree(child) {
    if (!child || child.killed || child.exitCode !== null) return;
    if (process.platform === 'win32') {
        try {
            spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
            return;
        } catch (e) {
            // fall through to the portable path
        }
    }
    try {
        child.kill('SIGTERM');
    } catch (e) { /* already gone */ }
    setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
    }, 3000).unref();
}

async function spawnOnce(port) {
    const env = Object.assign({}, process.env, {
        OFFLINE_MODE: 'true',
        NODE_ENV: 'development',
        HOST: '127.0.0.1',
        PORT: String(port),
        SESSION_SECRET: 'e2e-fixed-secret',
        E2E: '1'
    });
    delete env.DB_PASSWORD;

    const child = spawn(process.execPath, ['server.js'], {
        cwd: REPO_ROOT, // express.static('public') is a RELATIVE path
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });

    let out = '';
    let err = '';
    const append = (buf, which) => {
        const text = String(buf);
        if (which === 'out') {
            out = (out + text).slice(-MAX_LOG_BYTES);
        } else {
            err = (err + text).slice(-MAX_LOG_BYTES);
        }
    };
    child.stdout.on('data', b => append(b, 'out'));
    child.stderr.on('data', b => append(b, 'err'));

    let exited = null;
    child.on('exit', (code, signal) => { exited = { code, signal }; });

    const onProcessExit = () => killTree(child);
    process.on('exit', onProcessExit);

    const baseURL = `http://127.0.0.1:${port}`;
    const logs = () => `--- server stdout ---\n${out || '(empty)'}\n--- server stderr ---\n${err || '(empty)'}`;

    let stopped = false;
    const stop = async () => {
        if (stopped) return;
        stopped = true;
        process.removeListener('exit', onProcessExit);
        killTree(child);
        // Give the OS a moment to release the port so a second run in the
        // same session cannot hit EADDRINUSE on the same number.
        const deadline = Date.now() + 5000;
        while (exited === null && Date.now() < deadline) {
            await sleep(50);
        }
    };

    // Poll /health until the server declares itself ready IN DEMO MODE.
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (exited !== null) {
            await stop();
            const e = new Error(
                `Demo server exited before becoming healthy (code=${exited.code} signal=${exited.signal}) ` +
                `on port ${port}.\n${logs()}`
            );
            e.earlyExit = exited;
            e.serverLogs = logs();
            throw e;
        }
        try {
            const res = await fetch(baseURL + '/health');
            if (res.ok) {
                const body = await res.json();
                if (body && body.mode === 'DEMO') {
                    return { baseURL, port, pid: child.pid, child, stop, logs };
                }
                // Reachable but wrong mode - a config problem, not a timing one.
                await stop();
                throw new Error(
                    `Demo server on port ${port} reported mode="${body && body.mode}" ` +
                    `(expected "DEMO"). Is DB_PASSWORD leaking in from somewhere?\n${logs()}`
                );
            }
        } catch (e) {
            if (e && e.message && e.message.startsWith('Demo server on port')) throw e;
            // not listening yet - keep polling
        }
        await sleep(HEALTH_POLL_MS);
    }

    await stop();
    const e = new Error(
        `Demo server did not report mode "DEMO" on ${baseURL}/health within ${HEALTH_TIMEOUT_MS}ms.\n${logs()}`
    );
    e.serverLogs = logs();
    throw e;
}

/**
 * @returns {Promise<{baseURL:string, port:number, pid:number, stop:()=>Promise<void>, logs:()=>string}>}
 */
async function startDemoServer() {
    let lastError;
    // Tiny TOCTOU window between releasing the probe port and the child
    // binding it; retry on a different port rather than failing the suite.
    for (let attempt = 1; attempt <= 3; attempt++) {
        const port = await findFreePort();
        try {
            return await spawnOnce(port);
        } catch (e) {
            lastError = e;
            const logs = e.serverLogs || '';
            if (!/EADDRINUSE/.test(logs)) throw e;
        }
    }
    throw lastError;
}

module.exports = { startDemoServer, findFreePort, REPO_ROOT };

// `npm run offline` - replaces the broken cross-env script. Runs the same
// demo server in the foreground on PORT (default 3002) and pipes its output.
if (require.main === module && process.argv.includes('--foreground')) {
    const env = Object.assign({}, process.env, {
        OFFLINE_MODE: 'true',
        NODE_ENV: 'development'
    });
    const child = spawn(process.execPath, ['server.js'], {
        cwd: REPO_ROOT,
        env,
        stdio: 'inherit'
    });
    const forward = sig => process.on(sig, () => killTree(child));
    forward('SIGINT');
    forward('SIGTERM');
    child.on('exit', code => process.exit(code === null ? 1 : code));
}
