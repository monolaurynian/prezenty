// Moved verbatim from server.js (Phase 2 split)
const { pool } = require('./db');
const { cache } = require('./cache');

// Helper to get user identification status
const getUserIdentification = async (userId) => {
    try {
        const [rows] = await pool.execute('SELECT r.* FROM recipients r WHERE r.identified_by = ?', [userId]);
        return rows[0] || null;
    } catch (err) {
        throw err;
    }
};

// Helper to get recipient by ID
const getRecipientById = async (id) => {
    try {
        const [rows] = await pool.execute(`
            SELECT r.*, u.username as identified_by_username 
            FROM recipients r 
            LEFT JOIN users u ON r.identified_by = u.id 
            WHERE r.id = ?
        `, [id]);
        return rows[0] || null;
    } catch (err) {
        throw err;
    }
};

// Helper to get all presents with recipient and user info
const getAllPresents = async () => {
    const cacheKey = 'all_presents';
    const cached = cache.get(cacheKey);
    if (cached) {
        console.log('Using cached presents data');
        return cached;
    }

    try {
        const [rows] = await pool.execute(`
            SELECT p.id, p.title, p.recipient_id, p.comments, p.is_checked, p.reserved_by, p.created_by, p.created_at,
                   r.name as recipient_name, u.username as reserved_by_username
            FROM presents p 
            LEFT JOIN recipients r ON p.recipient_id = r.id 
            LEFT JOIN users u ON p.reserved_by = u.id
            ORDER BY p.id DESC
        `);

        cache.set(cacheKey, rows);
        return rows;
    } catch (err) {
        throw err;
    }
};

module.exports = { getUserIdentification, getRecipientById, getAllPresents };
