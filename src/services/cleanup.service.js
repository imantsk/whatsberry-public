const {
    SESSION_CLEANUP_INTERVAL,
    UNFINISHED_CLEANUP_INTERVAL,
    AUDIO_CLEANUP_INTERVAL,
    HEALTH_CHECK_INTERVAL
} = require('../config/constants');

/**
 * Setup all cleanup intervals for the application
 * @param {Object} sessionManager - Session manager instance
 * @param {Object} audioConverter - Audio converter instance
 * @returns {Object} Object containing all interval IDs for cleanup
 */
function setupCleanupIntervals(sessionManager, audioConverter) {
    // Session cleanup interval (remove inactive sessions after 24 hours)
    const sessionCleanupInterval = setInterval(() => {
        sessionManager.cleanupInactiveSessions();
    }, SESSION_CLEANUP_INTERVAL);

    // Unfinished session cleanup interval (remove unfinished sessions after 15 minutes)
    const unfinishedCleanupInterval = setInterval(() => {
        sessionManager.cleanupUnfinishedSessions();
    }, UNFINISHED_CLEANUP_INTERVAL);

    // Audio conversion cache cleanup interval (remove expired converted audio files)
    const audioCleanupInterval = setInterval(() => {
        audioConverter.cleanupAudioCache();
    }, AUDIO_CLEANUP_INTERVAL);

    // Session health check interval (check every 5 minutes)
    const healthCheckInterval = setInterval(() => {
        sessionManager.checkSessionHealth();
    }, HEALTH_CHECK_INTERVAL);

    console.log('Cleanup intervals initialized:');
    console.log(`   - Session cleanup: every ${SESSION_CLEANUP_INTERVAL / 1000 / 60} minutes`);
    console.log(`   - Unfinished session cleanup: every ${UNFINISHED_CLEANUP_INTERVAL / 1000 / 60} minutes`);
    console.log(`   - Audio cache cleanup: every ${AUDIO_CLEANUP_INTERVAL / 1000 / 60} minutes`);
    console.log(`   - Health check: every ${HEALTH_CHECK_INTERVAL / 1000 / 60} minutes`);

    return {
        sessionCleanupInterval,
        unfinishedCleanupInterval,
        audioCleanupInterval,
        healthCheckInterval
    };
}

/**
 * Clear all cleanup intervals
 * @param {Object} intervals - Object containing interval IDs
 */
function clearCleanupIntervals(intervals) {
    if (intervals.sessionCleanupInterval) {
        clearInterval(intervals.sessionCleanupInterval);
    }
    if (intervals.unfinishedCleanupInterval) {
        clearInterval(intervals.unfinishedCleanupInterval);
    }
    if (intervals.audioCleanupInterval) {
        clearInterval(intervals.audioCleanupInterval);
    }
    if (intervals.healthCheckInterval) {
        clearInterval(intervals.healthCheckInterval);
    }
}

module.exports = {
    setupCleanupIntervals,
    clearCleanupIntervals
};
