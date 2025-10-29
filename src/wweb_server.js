require('dotenv').config();
require('events').EventEmitter.defaultMaxListeners = 100
const express = require('express');
const socketIo = require('socket.io');
const http = require('http');
const path = require('path');

// Import configuration
const { API_KEY, DEFAULT_PORT } = require('./config/constants');

// Import core modules
const SessionManager = require('./core/SessionManager');
const AudioConverter = require('./core/AudioConverter');
const { initializeClient, initializeClientFallback } = require('./core/WhatsAppClient');

// Import middleware
const { setupMiddleware } = require('./middleware');

// Import routes
const setupRoutes = require('./routes');

// Import services
const { setupCleanupIntervals, clearCleanupIntervals } = require('./services/cleanup.service');

// Import socket handlers
const setupSocketHandlers = require('./sockets/handlers');

class MultiUserWWebServer {
    constructor(port = DEFAULT_PORT) {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });
        this.port = port;

        // API Key
        this.API_KEY = API_KEY;

        // Initialize core modules
        this.sessionManager = new SessionManager();
        this.sessionManager.setIO(this.io);

        this.audioConverter = new AudioConverter(path.join(__dirname, 'audio_cache'));

        // Setup middleware and get middleware functions
        const middleware = setupMiddleware(this.app, this.API_KEY);
        this.apiKeyMiddleware = middleware.apiKey;

        // Attach middleware to session manager for routes
        this.sessionManager.apiKeyMiddleware = this.apiKeyMiddleware;

        // Bind client initialization methods to session manager
        this.sessionManager.initializeClient = this.initializeClient.bind(this);
        this.sessionManager.initializeClientFallback = this.initializeClientFallback.bind(this);

        // Setup routes
        setupRoutes(this.app, this.sessionManager, this.audioConverter, this.io);

        // Setup socket handlers
        setupSocketHandlers(this.io, this.sessionManager);

        // Setup cleanup intervals
        this.cleanupIntervals = setupCleanupIntervals(this.sessionManager, this.audioConverter);
    }

    // Initialize WhatsApp client (wrapper method)
    async initializeClient(sessionId) {
        const session = this.sessionManager.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }
        const sessionDir = path.join(__dirname, 'data', sessionId);
        return await initializeClient(sessionId, session, this.sessionManager, this.io, sessionDir);
    }

    // Initialize WhatsApp client with fallback (wrapper method)
    async initializeClientFallback(sessionId) {
        const session = this.sessionManager.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }
        const sessionDir = path.join(__dirname, 'data', sessionId);
        const fallbackSessionDir = path.join(__dirname, 'data', `fallback_${sessionId}`);
        return await initializeClientFallback(
            sessionId,
            session,
            this.sessionManager,
            this.io,
            sessionDir,
            fallbackSessionDir
        );
    }

    start() {
        this.server.listen(this.port, () => {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`WhatsBerry Server running on port ${this.port}`);
            console.log(`${'='.repeat(60)}\n`);
            console.log(`Login page: http://localhost:${this.port}/login`);
            console.log(`API documentation: http://localhost:${this.port}/api`);
            console.log(`WebSocket server ready for real-time communications\n`);
            console.log(`${'='.repeat(60)}\n`);
        });
    }

    // Graceful shutdown
    async shutdown() {
        console.log('\nShutting down server...');

        // Clear all cleanup intervals
        clearCleanupIntervals(this.cleanupIntervals);

        // Destroy all sessions
        const sessionIds = Array.from(this.sessionManager.sessions.keys());
        await Promise.all(sessionIds.map(id => this.sessionManager.destroySession(id)));
        console.log('All sessions destroyed');

        // Close server
        this.server.close();
        console.log('Server closed');
    }
}

// Handle process termination
process.on('SIGINT', async () => {
    if (global.wwebServer) {
        await global.wwebServer.shutdown();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    if (global.wwebServer) {
        await global.wwebServer.shutdown();
    }
    process.exit(0);
});

// Create and start server
const server = new MultiUserWWebServer(process.env.PORT || 3000);
global.wwebServer = server;
server.start();

module.exports = MultiUserWWebServer;
