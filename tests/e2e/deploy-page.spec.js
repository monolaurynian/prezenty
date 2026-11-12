'use strict';
/**
 * /deploy: the terminal-style view of the Oracle VM's deploys.
 *
 *  - lib/deploy-status.js cleans what auto-deploy.sh writes (another process,
 *    so nothing in the files is trusted);
 *  - the demo server has no deploy folder: the API says so, the page says so,
 *    and both are for signed-in users only;
 *  - the page shows each state, treats a failed request during a deploy as
 *    "restarting", and draws commit messages as text, never as HTML.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('../fixtures');
const { readDeployStatus } = require('../../lib/deploy-status');

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const SHA2 = 'f0e1d2c3b4a5968778695a4b3c2d1e0f12345678';
const NOW = Date.parse('2026-11-12T12:00:00Z');

function makeDir(status, logLines) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-status-'));
    if (status !== undefined) fs.writeFileSync(path.join(dir, 'status.json'), typeof status === 'string' ? status : JSON.stringify(status));
    if (logLines !== undefined) fs.writeFileSync(path.join(dir, 'deploy.log'), logLines.join('\n') + '\n');
    return dir;
}

test.describe('readDeployStatus', () => {
    test('no folder or no file: not available', () => {
        expect(readDeployStatus({ dir: path.join(os.tmpdir(), 'no-such-deploy-dir') })).toEqual({ available: false });
        expect(readDeployStatus({ dir: makeDir() })).toEqual({ available: false });
    });

    test('a damaged status file: not available, no throw', () => {
        expect(readDeployStatus({ dir: makeDir('{ not json') })).toEqual({ available: false });
        expect(readDeployStatus({ dir: makeDir('[1,2]') })).toEqual({ available: false });
    });

    test('a normal idle status', () => {
        const dir = makeDir({
            state: 'idle', branch: 'main', checkedAt: '2026-11-12T11:58:00+00:00',
            deployed: { sha: SHA, subject: 'feat: x', date: '2026-11-12T11:00:00+00:00' },
            result: 'ok', finishedAt: '2026-11-12T11:00:05+00:00'
        }, ['2026-11-12T11:00:00+00:00 Deploying ' + SHA, '2026-11-12T11:00:05+00:00 Deployed ' + SHA + '.']);
        const status = readDeployStatus({ dir, now: NOW });
        expect(status).toMatchObject({
            available: true, state: 'idle', step: null, branch: 'main', result: 'ok',
            deployed: { sha: SHA, short: 'a1b2c3d', subject: 'feat: x', date: '2026-11-12T11:00:00.000Z' }
        });
        expect(status.log).toHaveLength(2);
    });

    test('values are checked, not trusted', () => {
        const dir = makeDir({
            state: 'hacked', step: 'rm -rf', reason: '<b>x</b>', result: 5,
            deployed: { sha: 'not-a-sha', subject: 'x' },
            target: { sha: SHA2, subject: 'line1\n\u001b[31mred\u0007' + 'y'.repeat(500) },
            checkedAt: 'yesterday', healthyAfterRollback: 'yes'
        }, ['\u001b[2Jclear\u0000screen', 'x'.repeat(1000)]);
        const status = readDeployStatus({ dir, now: NOW });
        expect(status.state).toBe('idle');                 // unknown state
        expect(status.step).toBeNull();
        expect(status.reason).toBeNull();
        expect(status.result).toBeNull();
        expect(status.deployed).toBeNull();                // sha is not hex
        expect(status.checkedAt).toBeNull();
        expect(status.healthyAfterRollback).toBeNull();
        expect(status.target.subject).not.toMatch(/[\u0000-\u001f]/);
        expect(status.target.subject.length).toBeLessThanOrEqual(200);
        expect(status.log[0]).toBe('[2Jclear screen');    // control characters become spaces
        expect(status.log[1].length).toBe(300);
    });

    test('only the last 80 log lines are returned', () => {
        const lines = Array.from({ length: 200 }, (_, i) => 'line ' + i);
        const status = readDeployStatus({ dir: makeDir({ state: 'idle' }, lines), now: NOW });
        expect(status.log).toHaveLength(80);
        expect(status.log[79]).toBe('line 199');
    });

    test('a deploy that has been "running" for 20+ minutes is a failure, not progress', () => {
        const fresh = readDeployStatus({
            dir: makeDir({ state: 'deploying', step: 'restarting', startedAt: '2026-11-12T11:55:00Z' }), now: NOW
        });
        expect(fresh).toMatchObject({ state: 'deploying', step: 'restarting' });
        const old = readDeployStatus({
            dir: makeDir({ state: 'deploying', step: 'restarting', startedAt: '2026-11-12T11:30:00Z' }), now: NOW
        });
        expect(old).toMatchObject({ state: 'failed', reason: 'stale', step: null });
        const undated = readDeployStatus({ dir: makeDir({ state: 'deploying' }), now: NOW });
        expect(undated.state).toBe('failed');
    });
});

test.describe('/api/deploy-status and /deploy on a host without deploys (the demo server)', () => {
    test('the API answers { available: false } to a signed-in user', async ({ request }) => {
        const response = await request.get('/api/deploy-status');
        expect(response.status()).toBe(200);
        expect(response.headers()['cache-control']).toContain('no-store');
        expect(await response.json()).toEqual({ available: false });
    });

    test('signed-out visitors get 401 from the API and a redirect from the page', async ({ playwright, baseURL }) => {
        const anonymous = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
        expect((await anonymous.get('/api/deploy-status')).status()).toBe(401);
        const page = await anonymous.get('/deploy', { maxRedirects: 0 });
        expect(page.status()).toBe(302);
        expect(page.headers().location).toBe('/');
        await anonymous.dispose();
    });

    test('the page says there is no data', async ({ page }) => {
        await page.goto('/deploy');
        await expect(page.locator('#statusLine')).toContainText('BRAK DANYCH');
        await expect(page.locator('#log')).toContainText('(pusto)');
    });
});

test.describe('the /deploy page', () => {
    const idle = {
        available: true, state: 'idle', step: null, branch: 'main',
        deployed: { sha: SHA, short: 'a1b2c3d', subject: 'feat: second place', date: new Date(Date.now() - 3600e3).toISOString() },
        target: null, skipped: null, result: 'ok', reason: null, healthyAfterRollback: null,
        startedAt: null, finishedAt: null, checkedAt: new Date(Date.now() - 120e3).toISOString(),
        log: ['2026-11-12T21:23:28+00:00 Deploying ' + SHA2, '2026-11-12T21:23:29+00:00 Deployed ' + SHA2 + '.']
    };

    async function serve(page, answers) {
        let i = 0;
        await page.route('**/api/deploy-status', route => {
            const answer = answers[Math.min(i++, answers.length - 1)];
            if (answer === 'abort') return route.abort();
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) });
        });
    }

    test('idle: green, with the deployed commit, the last check and the log', async ({ page }) => {
        await serve(page, [idle]);
        await page.goto('/deploy');
        await expect(page.locator('#statusLine')).toContainText('GOTOWE');
        await expect(page.locator('#statusLine')).toHaveClass(/is-ok/);
        await expect(page.locator('#facts')).toContainText('a1b2c3d');
        await expect(page.locator('#facts')).toContainText('feat: second place');
        await expect(page.locator('#facts')).toContainText('2 min temu (co 5 min)');
        await expect(page.locator('#log .row')).toHaveCount(2);
        await expect(page.locator('#log .row.is-ok')).toHaveCount(1);
    });

    test('deploying: amber with a step, then "restarting" while the app is down, then ready', async ({ page }) => {
        const deploying = { ...idle, state: 'deploying', step: 'restarting', target: { sha: SHA2, short: 'f0e1d2c', subject: 'fix: next' }, startedAt: new Date().toISOString() };
        await serve(page, [deploying, 'abort', idle]);
        await page.goto('/deploy');
        await expect(page.locator('#statusLine')).toContainText('WDRAŻANIE');
        await expect(page.locator('#statusLine')).toContainText('krok 3/4: restart aplikacji');
        await expect(page.locator('#statusLine')).toHaveClass(/is-busy/);
        await expect(page.locator('#facts')).toContainText('wdrażane');
        await expect(page.locator('#facts')).toContainText('fix: next');
        await expect(page.locator('#statusLine')).toContainText('RESTART', { timeout: 6000 });
        await expect(page.locator('#statusLine')).toContainText('GOTOWE', { timeout: 10000 });
    });

    test('rolled back: red, names the rejected commit and the one still running', async ({ page }) => {
        await serve(page, [{
            ...idle, state: 'rolled_back', result: 'rolled_back', reason: 'health_failed', healthyAfterRollback: true,
            skipped: { sha: SHA2, short: 'f0e1d2c', subject: 'feat: broken' }, finishedAt: new Date().toISOString()
        }]);
        await page.goto('/deploy');
        await expect(page.locator('#statusLine')).toContainText('WYCOFANO');
        await expect(page.locator('#statusLine')).toHaveClass(/is-bad/);
        await expect(page.locator('#facts')).toContainText('odrzucone');
        await expect(page.locator('#facts')).toContainText('feat: broken');
        await expect(page.locator('#facts')).toContainText('feat: second place');
    });

    test('unhealthy even after the rollback is called out', async ({ page }) => {
        await serve(page, [{ ...idle, state: 'rolled_back', reason: 'health_failed', healthyAfterRollback: false }]);
        await page.goto('/deploy');
        await expect(page.locator('#statusLine')).toContainText('nie odpowiada nawet po wycofaniu');
    });

    test('commit messages and log lines are text, never HTML', async ({ page }) => {
        const evil = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';
        await serve(page, [{
            ...idle, deployed: { ...idle.deployed, subject: evil },
            log: ['2026-11-12T21:23:28+00:00 ' + evil]
        }]);
        await page.goto('/deploy');
        await expect(page.locator('#facts')).toContainText(evil);
        await expect(page.locator('#log')).toContainText(evil);
        expect(await page.locator('.term-body img, .term-body script').count()).toBe(0);
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    });

    test('fits a 320px phone without sideways scrolling', async ({ page }) => {
        await page.setViewportSize({ width: 320, height: 640 });
        await serve(page, [{ ...idle, deployed: { ...idle.deployed, subject: 'x'.repeat(190) }, log: ['y'.repeat(300)] }]);
        await page.goto('/deploy');
        await expect(page.locator('#statusLine')).toContainText('GOTOWE');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
});