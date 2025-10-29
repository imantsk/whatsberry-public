const express = require('express');
const apiKeyMiddleware = require('./apiKey');
const corsMiddleware = require('./cors');

// Setup all application middleware
function setupMiddleware(app, apiKey) {
    // Body parsing middleware
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // CORS middleware
    app.use(corsMiddleware());

    // Return middleware functions for route-specific use
    return {
        apiKey: apiKeyMiddleware(apiKey)
    };
}

module.exports = {
    setupMiddleware,
    apiKeyMiddleware,
    corsMiddleware
};
