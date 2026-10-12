// Moved verbatim from server.js (Phase 2 split)
const express = require('express');
const router = express.Router();
const { DEMO_MODE, pool } = require('../lib/db');
const { handleDbError, badRequest } = require('../lib/http-errors');
const { requireAuth } = require('../lib/auth');
const { cache, clearCombinedDataCache } = require('../lib/cache');
const { getUserIdentification } = require('../lib/queries');

// ===== Archive: move a finished year's presents out of the main table =====

async function ensureArchiveTable() {
    await pool.execute(`CREATE TABLE IF NOT EXISTS presents_archive (
        id INT AUTO_INCREMENT PRIMARY KEY,
        original_id INT NOT NULL,
        title VARCHAR(500) NOT NULL,
        recipient_id INT NULL,
        recipient_name VARCHAR(255) NULL,
        comments TEXT NULL,
        is_checked BOOLEAN DEFAULT FALSE,
        reserved_by INT NULL,
        reserved_by_username VARCHAR(255) NULL,
        created_by INT NULL,
        created_by_username VARCHAR(255) NULL,
        created_at TIMESTAMP NULL,
        archive_year INT NOT NULL,
        archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_archive_year (archive_year)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

// Archive all current presents under a given year label and clear the slate.
// Requires typing the confirmation word - this moves every present.
router.post('/api/archive/run', requireAuth, async (req, res) => {
    const { year, confirmText } = req.body;

    if (DEMO_MODE) {
        return badRequest(res, 'Archiwizacja jest niedostępna w trybie demo');
    }
    if (confirmText !== 'ARCHIWIZUJ') {
        return badRequest(res, 'Wpisz ARCHIWIZUJ aby potwierdzić');
    }
    const archiveYear = parseInt(year);
    if (!archiveYear || archiveYear < 2020 || archiveYear > 2100) {
        return badRequest(res, 'Nieprawidłowy rok');
    }

    let conn;
    try {
        await ensureArchiveTable();
        conn = await pool.getConnection();
        await conn.beginTransaction();

        // Copy presents with names denormalized, so the archive stays
        // readable even if recipients/users are removed later
        const [copied] = await conn.execute(`
            INSERT INTO presents_archive
                (original_id, title, recipient_id, recipient_name, comments, is_checked,
                 reserved_by, reserved_by_username, created_by, created_by_username, created_at, archive_year)
            SELECT p.id, p.title, p.recipient_id, r.name, p.comments, p.is_checked,
                   p.reserved_by, ur.username, p.created_by, uc.username, p.created_at, ?
            FROM presents p
            LEFT JOIN recipients r ON p.recipient_id = r.id
            LEFT JOIN users ur ON p.reserved_by = ur.id
            LEFT JOIN users uc ON p.created_by = uc.id
        `, [archiveYear]);

        const [deleted] = await conn.execute('DELETE FROM presents');

        // Fresh year, fresh activity feed
        const [clearedNotifications] = await conn.execute('DELETE FROM notifications');

        await conn.commit();

        // Invalidate server-side caches
        try {
            cache.invalidatePresents();
            clearCombinedDataCache();
        } catch (e) { /* cache errors are non-fatal */ }

        console.log(`🗄️ [ARCHIVE] User ${req.session.username} archived year ${archiveYear}: ` +
            `${copied.affectedRows} presents moved, ${clearedNotifications.affectedRows} notifications cleared`);

        res.json({
            success: true,
            archivedPresents: copied.affectedRows,
            deletedPresents: deleted.affectedRows,
            clearedNotifications: clearedNotifications.affectedRows,
            year: archiveYear
        });
    } catch (err) {
        if (conn) {
            try { await conn.rollback(); } catch (e) { /* ignore */ }
        }
        console.error('❌ [ARCHIVE] Archiving failed:', err);
        handleDbError(err, res, 'Błąd podczas archiwizacji');
    } finally {
        if (conn) conn.release();
    }
});

// List available archive years with counts
router.get('/api/archive/years', requireAuth, async (req, res) => {
    if (DEMO_MODE) return res.json({ years: [] });
    try {
        await ensureArchiveTable();
        const [rows] = await pool.execute(`
            SELECT archive_year AS year, COUNT(*) AS count
            FROM presents_archive
            GROUP BY archive_year
            ORDER BY archive_year DESC
        `);
        res.json({ years: rows });
    } catch (err) {
        handleDbError(err, res, 'Błąd podczas pobierania archiwum');
    }
});

// Get archived presents for a year
router.get('/api/archive/presents', requireAuth, async (req, res) => {
    if (DEMO_MODE) return res.json({ presents: [] });
    const year = parseInt(req.query.year);
    if (!year) return badRequest(res, 'Podaj rok');
    try {
        await ensureArchiveTable();
        const [rows] = await pool.execute(`
            SELECT title, recipient_id, recipient_name, comments, is_checked,
                   reserved_by_username, created_by_username, created_at
            FROM presents_archive
            WHERE archive_year = ?
            ORDER BY recipient_name, title
        `, [year]);

        // Spoiler protection: the identified recipient must not learn who
        // reserved/bought their own presents - mask names server-side so
        // they never even reach the browser
        const identified = await getUserIdentification(req.session.userId);
        const presents = rows.map(p => {
            const isOwn = identified && p.recipient_id === identified.id;
            const { recipient_id, ...rest } = p;
            if (isOwn) {
                return { ...rest, reserved_by_username: null, spoiler: true };
            }
            return rest;
        });

        res.json({ presents });
    } catch (err) {
        handleDbError(err, res, 'Błąd podczas pobierania archiwum');
    }
});

module.exports = router;
