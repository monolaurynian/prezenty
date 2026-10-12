'use strict';
/**
 * Runs once before the whole suite:
 *  1. boots the real server.js in demo mode on a free port,
 *  2. publishes its URL via process.env.E2E_BASE_URL (workers inherit it),
 *  3. logs in once and persists the session to tests/.auth/demo.json so no
 *     individual spec has to repeat the login,
 *  4. returns a teardown that kills the server process tree - it runs after
 *     the suite whether it passed or failed.
 */

const fs = require('fs');
const path = require('path');
const { request } = require('@playwright/test');
const { startDemoServer } = require('./helpers/start-demo-server');

const AUTH_DIR = path.join(__dirname, '.auth');
const AUTH_FILE = path.join(AUTH_DIR, 'demo.json');

module.exports = async function globalSetup() {
    const started = Date.now();
    const server = await startDemoServer();
    process.env.E2E_BASE_URL = server.baseURL;
    console.log(`[e2e] demo server ready at ${server.baseURL} (pid ${server.pid}) in ${Date.now() - started}ms`);

    try {
        // Demo login accepts any non-empty username/password (server.js:701-740)
        // and always yields user id 1 - see tests/README.md "Honest limits".
        fs.mkdirSync(AUTH_DIR, { recursive: true });
        const ctx = await request.newContext({ baseURL: server.baseURL });
        const res = await ctx.post('/api/login', {
            data: { username: 'e2e', password: 'e2e' }
        });
        if (!res.ok()) {
            throw new Error(`Demo login failed: ${res.status()} ${await res.text()}\n${server.logs()}`);
        }
        await ctx.storageState({ path: AUTH_FILE });
        await ctx.dispose();
        console.log(`[e2e] logged in, session stored at ${path.relative(process.cwd(), AUTH_FILE)}`);
    } catch (err) {
        // Never leave the child running if setup fails half way.
        await server.stop();
        throw err;
    }

    return async () => {
        await server.stop();
        console.log(`[e2e] demo server on port ${server.port} stopped`);
    };
};
