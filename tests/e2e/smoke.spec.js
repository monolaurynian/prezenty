'use strict';
/**
 * Proves the harness itself works: the real server booted in demo mode, the
 * shared session is accepted, every page renders without throwing, and
 * requireAuth is still enforced.
 */
const { test, expect } = require('../fixtures');

const PAGES = [
    { path: '/', name: 'home (dashboard)' },
    { path: '/recipients', name: 'recipients' },
    { path: '/osoby', name: 'osoby' },
    { path: '/activity', name: 'activity' },
    { path: '/leaderboard.html', name: 'leaderboard' },
    { path: '/wiadomosci', name: 'wiadomosci (chat)' },
    { path: '/rezerwacje', name: 'rezerwacje' },
    { path: '/archiwum', name: 'archiwum' },
    { path: '/ustawienia', name: 'ustawienia' },
    { path: '/formularz', name: 'formularz' }
];

test.describe('harness smoke', () => {
    test('health endpoint reports demo mode', async ({ request }) => {
        const res = await request.get('/health');
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.mode).toBe('DEMO');
        expect(body.database).toBe('disabled');
    });

    test('shared session is authenticated', async ({ request }) => {
        const res = await request.get('/api/auth');
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.authenticated).toBe(true);
        expect(body.user.id).toBe(1);
    });

    test('requireAuth still rejects an anonymous request', async ({ playwright, baseURL }) => {
        // A brand new context with NO storage state - proves demo mode did
        // not weaken the auth gate. storageState is passed explicitly empty:
        // contexts created through the `playwright` fixture otherwise inherit
        // `use.storageState` from the config and would arrive logged in.
        const anon = await playwright.request.newContext({
            baseURL,
            storageState: { cookies: [], origins: [] }
        });
        try {
            for (const path of ['/api/recipients', '/api/presents', '/api/wiadomosci/threads']) {
                const res = await anon.get(path);
                expect(res.status(), `${path} must require auth`).toBe(401);
            }
        } finally {
            await anon.dispose();
        }
    });

    for (const p of PAGES) {
        test(`page loads: ${p.name}`, async ({ page }) => {
            const response = await page.goto(p.path, { waitUntil: 'domcontentloaded' });
            expect(response.status(), `${p.path} status`).toBeLessThan(400);
            // A real rendered landmark, not just a 200. `:visible` skips the
            // off-screen menu/dialog headings every page carries.
            const heading = page
                .locator('h1:visible, h2:visible, h3:visible, h4:visible, h5:visible, [role="heading"]:visible')
                .first();
            await expect(heading).toBeVisible();
            await expect(heading).not.toHaveText('');
        });
    }
});
