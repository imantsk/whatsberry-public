const os = require('os');

/**
 * Setup stats and monitoring routes
 * @param {Express} app - Express app instance
 * @param {Object} sessionManager - Session manager with sessions Map and middleware functions
 * @param {Object} audioConverter - Audio converter instance (not used in stats routes but kept for consistency)
 */
function setupStatsRoutes(app, sessionManager) {
    // Server stats (for monitoring - public, no sensitive data)
    app.get('/stats', (req, res) => {
        // Count sessions by status
        let readySessions = 0;
        let notReadySessions = 0;

        for (const [sessionId, session] of sessionManager.sessions.entries()) {
            if (session.isReady) {
                readySessions++;
            } else {
                notReadySessions++;
            }
        }

        // WebSocket stats
        const wsStats = {
            totalConnections: sessionManager.io.engine.clientsCount,
            connectedSockets: sessionManager.io.sockets.sockets.size
        };

        res.json({
            activeSessions: sessionManager.sessions.size,
            activeUsers: sessionManager.userSessions.size,
            readySessions: readySessions,
            notReadySessions: notReadySessions,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            websocket: wsStats,
            cleanupConfig: {
                sessionTimeoutHours: sessionManager.sessionTimeout / (1000 * 60 * 60),
                unfinishedSessionTimeoutMinutes: sessionManager.unfinishedSessionTimeout / (1000 * 60),
                audioCleanupIntervalMinutes: 30,
                sessionCleanupIntervalMinutes: 60
            }
        });
    });

    // Health check endpoint with detailed system metrics
    app.get('/health', (req, res) => {
        const totalMemory = os.totalmem();
        const freeMemory = os.freemem();
        const usedMemory = totalMemory - freeMemory;

        // Calculate CPU usage (delta method)
        const cpus = os.cpus();
        const now = Date.now();
        let cpuUsagePercent = 0;

        // Calculate current CPU times
        let currentIdle = 0;
        let currentTotal = 0;

        cpus.forEach(cpu => {
            for (let type in cpu.times) {
                currentTotal += cpu.times[type];
            }
            currentIdle += cpu.times.idle;
        });

        // If previous data, calculate usage based on delta
        if (sessionManager.previousCpuUsage && (now - sessionManager.lastCpuCheck) > 100) {
            const idleDelta = currentIdle - sessionManager.previousCpuUsage.idle;
            const totalDelta = currentTotal - sessionManager.previousCpuUsage.total;

            if (totalDelta > 0) {
                cpuUsagePercent = 100 - (100 * idleDelta / totalDelta);
            }
        }

        // Store current values for next calculation
        sessionManager.previousCpuUsage = {
            idle: currentIdle,
            total: currentTotal
        };
        sessionManager.lastCpuCheck = now;

        // Get load average (1, 5, 15 minutes)
        const loadAvg = os.loadavg();

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            systemMemory: {
                total: totalMemory,
                used: usedMemory,
                free: freeMemory,
                usedPercentage: (usedMemory / totalMemory) * 100
            },
            cpu: {
                count: cpus.length,
                usage: Math.max(0, Math.min(100, cpuUsagePercent)),
                loadAverage: {
                    '1min': loadAvg[0],
                    '5min': loadAvg[1],
                    '15min': loadAvg[2]
                }
            },
            cpus: cpus.length,
            active_sessions: sessionManager.sessions.size
        });
    });
}

module.exports = { setupStatsRoutes };
