require('dotenv').config();

module.exports = {
    // API Key for app authentication
    API_KEY: process.env.API_KEY,

    // Session timeouts
    SESSION_TIMEOUT: 24 * 60 * 60 * 1000, // 24 hours
    UNFINISHED_SESSION_TIMEOUT: 15 * 60 * 1000, // 15 minutes

    // Audio conversion settings
    AUDIO_CONVERSION_TTL: 2 * 60 * 60 * 1000, // 2 hours TTL for converted audio
    AUDIO_BITRATE: 128,
    AUDIO_FREQUENCY: 44100,
    AUDIO_CHANNELS: 2, // Stereo
    AUDIO_CONVERSION_TIMEOUT: 60000, // 60 seconds max for conversion

    // Cleanup intervals
    SESSION_CLEANUP_INTERVAL: 60 * 60 * 1000, // Check every hour
    UNFINISHED_CLEANUP_INTERVAL: 5 * 60 * 1000, // Check every 5 minutes
    AUDIO_CLEANUP_INTERVAL: 30 * 60 * 1000, // Check every 30 minutes
    HEALTH_CHECK_INTERVAL: 5 * 60 * 1000, // Check every 5 minutes

    // Server settings
    DEFAULT_PORT: 3000,
    REQUEST_SIZE_LIMIT: '50mb'
};
