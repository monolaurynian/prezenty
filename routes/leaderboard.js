// Moved verbatim from server.js (Phase 2 split)
const express = require('express');
const router = express.Router();
const { DEMO_MODE, pool } = require('../lib/db');
const { demoLeaderboard } = require('../lib/demo-data');

// Leaderboard API - Get most active users
router.get('/api/leaderboard', async (req, res) => {
    try {
        console.log('📊 [LEADERBOARD] Fetching most active users');

        if (DEMO_MODE) {
            return res.json({ users: demoLeaderboard.users, cumulativeStats: demoLeaderboard.cumulativeStats });
        }

        // Rank PEOPLE (recipients) by the presents on their wishlist -
        // regardless of who added them and whether the person has an
        // account / identified themselves. Activity stats (bought/reserved
        // BY the person) come through their identifying user, if any.
        const [users] = await pool.execute(`
            SELECT 
                r.id,
                r.name as username,
                r.id as recipient_id,
                CASE WHEN r.profile_picture IS NOT NULL 
                    THEN CONCAT('/api/recipients/', r.id, '/profile-picture')
                    ELSE NULL 
                END as profile_picture,
                COUNT(DISTINCT p.id) as total_presents,
                SUM(CASE WHEN p.is_checked = 1 THEN 1 ELSE 0 END) as bought_presents,
                SUM(CASE WHEN p.reserved_by IS NOT NULL THEN 1 ELSE 0 END) as reserved_presents,
                SUM(CASE WHEN p.is_checked = 0 AND p.reserved_by IS NULL THEN 1 ELSE 0 END) as available_presents,
                (SELECT COUNT(*) FROM presents WHERE reserved_by = r.identified_by AND is_checked = 1) as user_bought_count,
                (SELECT COUNT(*) FROM presents WHERE reserved_by = r.identified_by) as user_reserved_count
            FROM recipients r
            LEFT JOIN presents p ON p.recipient_id = r.id
            GROUP BY r.id, r.name, r.profile_picture, r.identified_by
            HAVING total_presents > 0
            ORDER BY total_presents DESC
            LIMIT 10
        `);

        // Get cumulative stats from ALL presents in the system
        const [cumulativeStats] = await pool.execute(`
            SELECT 
                COUNT(*) as totalPresents,
                SUM(CASE WHEN is_checked = 1 THEN 1 ELSE 0 END) as boughtPresents,
                SUM(CASE WHEN reserved_by IS NOT NULL THEN 1 ELSE 0 END) as reservedPresents
            FROM presents
        `);

        console.log(`✅ [LEADERBOARD] Found ${users.length} active users`);
        console.log(`📊 [LEADERBOARD] Cumulative stats:`, cumulativeStats[0]);

        res.json({ 
            users: users,
            cumulativeStats: cumulativeStats[0]
        });
    } catch (err) {
        console.error('❌ [LEADERBOARD] Error fetching leaderboard:', err);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

module.exports = router;
