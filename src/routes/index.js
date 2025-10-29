const path = require('path');
const express = require('express');
const serveIndex = require('serve-index');
const fs = require('fs');
const { marked } = require('marked');

// Import route setup functions
const { setupAuthRoutes } = require('./auth.routes');
const { setupChatRoutes } = require('./chat.routes');
const { setupMediaRoutes } = require('./media.routes');
const { setupStatsRoutes } = require('./stats.routes');
const setupDebugRoutes = require('./debug.routes');

/**
 * Setup all application routes
 * @param {Express.Application} app - Express app instance
 * @param {Object} sessionManager - Session manager instance
 * @param {Object} audioConverter - Audio converter instance
 * @param {SocketIO.Server} io - Socket.IO server instance
 */
function setupRoutes(app, sessionManager, audioConverter, io) {
    // Serve static files
    app.use('/static', express.static(path.join(__dirname, '../../public')));

    // Serve public files
    app.use(express.static(path.join(__dirname, '../../public')));

    // Login page
    app.get('/login', (req, res) => {
        res.sendFile(path.join(__dirname, '../../public/login.html'));
    });

    // Serve login.html
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, '../../public/login.html'));
    });

    // Setup all route groups
    setupAuthRoutes(app, sessionManager, audioConverter, io);
    setupChatRoutes(app, sessionManager, audioConverter);
    setupMediaRoutes(app, sessionManager, audioConverter);
    setupStatsRoutes(app, sessionManager, io);
    setupDebugRoutes(app, sessionManager, io);

    // API documentation route
    app.get('/api', (req, res) => {
        res.json({
            message: 'WhatsBerry API - Self-Hosted',
            version: '0.10.3-beta',
            endpoints: {
                session: {
                    'POST /create-session': 'Create or get a session (requires API key)',
                    'GET /session/:sessionId/qr': 'Get QR code for session (requires API key)',
                    'POST /init': 'Initialize WhatsApp session (requires API key)',
                    'POST /start-session/:sessionId': 'Start WhatsApp session (requires API key)',
                    'POST /session/:sessionId/logout': 'Logout and destroy session (requires API key)'
                },
                messaging: {
                    'POST /session/:sessionId/send-message': 'Send text message (requires API key)',
                    'POST /session/:sessionId/send-media': 'Send media message (requires API key)',
                    'POST /session/:sessionId/chat/:chatId/mark-read': 'Mark chat messages as read (requires API key)'
                },
                chats: {
                    'GET /session/:sessionId/chats': 'Get all chats (requires API key)',
                    'GET /session/:sessionId/chat/:chatId/messages': 'Get messages from a chat (requires API key)',
                    'GET /session/:sessionId/contacts': 'Get contacts (requires API key)',
                    'GET /session/:sessionId/group/:groupId/participants': 'Get group participants (requires API key)'
                },
                media: {
                    'GET /session/:sessionId/message/:messageId/media': 'Download media from message (requires API key)',
                    'GET /session/:sessionId/chat/:chatId/media/:messageIndex': 'Download media by chat and message index (requires API key)',
                    'GET /formats/:mimetype': 'Get supported formats for a MIME type',
                    'GET /ffmpeg/status': 'Get FFmpeg availability status',
                    'GET /audio-cache/stats': 'Get audio conversion cache statistics'
                },
                monitoring: {
                    'GET /health': 'Health check endpoint',
                    'GET /stats': 'Server statistics',
                    'GET /session/:sessionId/status': 'Get session status (requires API key)'
                },
                debug: {
                    'GET /debug/sessions': 'List all sessions (requires API key)',
                    'GET /debug/session-details': 'Detailed session info (requires API key)',
                    'GET /debug/puppeteer': 'Test Puppeteer (requires API key)',
                    'GET /debug/sockets': 'List socket connections (requires API key)',
                    'POST /debug/test-qr-flow': 'Test QR generation flow (requires API key)',
                    'POST /debug/test-whatsapp-client': 'Test WhatsApp client initialization (requires API key)'
                }
            },
            websockets: {
                clientEvents: {
                    'join_session': 'Join a session room (payload: sessionId)',
                    'leave_session': 'Leave a session room (payload: sessionId)',
                    'request_qr': 'Request QR code for a session (payload: sessionId)',
                    'request_session_status': 'Request current session status (payload: sessionId)',
                    'ping': 'Ping server for connection test (no payload)'
                },
                serverEvents: {
                    'session_joined': 'Confirmation that socket joined session room (payload: {sessionId, socketId})',
                    'qr': 'QR code for WhatsApp authentication (payload: qrCode string)',
                    'ready': 'Session is authenticated and ready (payload: {phoneNumber, sessionId})',
                    'authenticated': 'Session authenticated successfully',
                    'loading_screen': 'WhatsApp loading screen progress (payload: {percent, message})',
                    'auth_failure': 'Authentication failed (payload: error message)',
                    'disconnected': 'Client disconnected from WhatsApp (payload: reason)',
                    'session_status': 'Session status information (payload: {sessionId, isReady, hasQR, lastActivity, phoneNumber})',
                    'error': 'Error occurred (payload: error message)',
                    'pong': 'Ping response (payload: {timestamp})'
                }
            },
            authentication: {
                apiKey: 'Required in X-API-Key header for all protected endpoints'
            }
        });
    });

    console.log('All routes initialized');
}

module.exports = setupRoutes;
