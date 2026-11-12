'use strict';
/**
 * Presence dots on a person's avatar (recipients-list.js presenceDot):
 * green = online (seen within 5 min), yellow = seen within the last hour,
 * red = offline. The server sends `presence` ('online' | 'recent' | 'offline')
 * and still sends the boolean `online`, which is the fallback for data
 * cached before `presence` existed.
 */
const { test, expect } = require('../fixtures');
const { openPage } = require('../helpers/pages');

test.describe('presence dots', () => {
    test('three states, each with its colour and tooltip', async ({ page }) => {
        await openPage(page, { path: '/recipients', name: 'recipients', ready: '.present-name' });
        const dots = await page.evaluate(() => ({
            online: presenceDot({ presence: 'online', online: true }),
            recent: presenceDot({ presence: 'recent', online: false }),
            offline: presenceDot({ presence: 'offline', online: false }),
            legacyOnline: presenceDot({ online: true }),
            legacyOffline: presenceDot({ online: false })
        }));
        expect(dots.online).toEqual({ color: '#4CAF50', title: 'Online' });
        expect(dots.recent).toEqual({ color: '#FFC107', title: 'Ostatnia aktywność w ciągu godziny' });
        expect(dots.offline).toEqual({ color: '#F44336', title: 'Offline' });
        expect(dots.legacyOnline).toEqual(dots.online);
        expect(dots.legacyOffline).toEqual(dots.offline);
    });
});