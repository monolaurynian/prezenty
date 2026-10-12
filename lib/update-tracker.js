// Moved verbatim from server.js (Phase 2 split)

// Update tracking system for incremental updates
const updateTracker = {
    updates: [],
    maxUpdates: 100, // Keep last 100 updates

    addUpdate(type, data) {
        const update = {
            type,
            data,
            timestamp: Date.now()
        };

        this.updates.push(update);

        // Keep only recent updates
        if (this.updates.length > this.maxUpdates) {
            this.updates = this.updates.slice(-this.maxUpdates);
        }

        console.log(`[UpdateTracker] Added update: ${type}`, data);
    },

    getUpdatesSince(timestamp) {
        const since = parseInt(timestamp) || 0;
        return this.updates.filter(update => update.timestamp > since);
    },

    clear() {
        this.updates = [];
    }
};

module.exports = { updateTracker };
