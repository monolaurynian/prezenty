// Moved verbatim from server.js (Phase 2 split)

// Simple in-memory cache for database queries
const cache = {
    data: new Map(),
    timestamps: new Map(),
    TTL: 10000, // 10 seconds

    get(key) {
        const timestamp = this.timestamps.get(key);
        if (timestamp && (Date.now() - timestamp) < this.TTL) {
            return this.data.get(key);
        }
        this.data.delete(key);
        this.timestamps.delete(key);
        return null;
    },

    set(key, value) {
        this.data.set(key, value);
        this.timestamps.set(key, Date.now());
    },

    clear() {
        this.data.clear();
        this.timestamps.clear();
    },

    invalidatePresents() {
        this.data.delete('all_presents');
        this.data.delete('recipients_with_presents');
        this.timestamps.delete('all_presents');
        this.timestamps.delete('recipients_with_presents');
    },

    invalidateRecipients() {
        this.data.delete('all_recipients');
        this.data.delete('recipients_with_presents');
        this.timestamps.delete('all_recipients');
        this.timestamps.delete('recipients_with_presents');
    }
};

// Combined endpoint for recipients and presents (optimized with caching)
const combinedDataCache = new Map();
const COMBINED_CACHE_TTL = 30000; // 30 seconds cache

// Helper function to clear combined data cache
function clearCombinedDataCache() {
    combinedDataCache.clear();
    console.log('[Cache] Combined data cache cleared');
}

module.exports = { cache, combinedDataCache, COMBINED_CACHE_TTL, clearCombinedDataCache };
