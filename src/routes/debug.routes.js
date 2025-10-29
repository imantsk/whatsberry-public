const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs').promises;
const path = require('path');

/**
 * Debug routes for testing and monitoring WhatsApp server
 * @param {Object} app - Express app instance
 * @param {Object} sessionManager - Session manager instance with sessions and userSessions Maps
 * @param {Object} io - Socket.io instance
 */
module.exports = function setupDebugRoutes(app, sessionManager, io) {

    // Debug endpoint to list sessions (API key protected)
    app.get('/debug/sessions', sessionManager.apiKeyMiddleware, (req, res) => {
        const sessions = Array.from(sessionManager.sessions.entries()).map(([sessionId, session]) => ({
            sessionId,
            isReady: session.isReady,
            isAuthenticated: session.isAuthenticated,
            hasQR: !!session.qrCode,
            phoneNumber: session.phoneNumber,
            lastActivity: session.lastActivity ? new Date(session.lastActivity).toISOString() : null
        }));
        res.json({ sessions });
    });

    // Detailed session info (API key protected - contains sensitive data)
    app.get('/debug/session-details', sessionManager.apiKeyMiddleware, (req, res) => {
        const sessionDetails = [];

        for (const [sessionId, session] of sessionManager.sessions.entries()) {
            sessionDetails.push({
                sessionId: sessionId,
                isReady: session.isReady,
                hasQR: !!session.qrCode,
                phoneNumber: session.phoneNumber || null,
                lastActivity: session.lastActivity ? new Date(session.lastActivity).toISOString() : null,
                inactiveDuration: session.lastActivity ? Date.now() - session.lastActivity : 0
            });
        }

        res.json({ sessionDetails });
    });

    // Debug route to test Puppeteer
    app.get('/debug/puppeteer', async (req, res) => {
        try {
            console.log(`Testing Puppeteer launch...`);
            const puppeteer = require('puppeteer');

            const browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor,'
                ]
            });

            console.log(`Puppeteer browser launched successfully`);

            const page = await browser.newPage();
            await page.goto('https://web.whatsapp.com', { waitUntil: 'networkidle0', timeout: 30000 });

            console.log(`WhatsApp Web loaded successfully`);

            const title = await page.title();
            await browser.close();

            res.json({
                success: true,
                message: 'Puppeteer working correctly',
                pageTitle: title,
                platform: process.platform
            });
        } catch (error) {
            console.error(`Puppeteer test failed:`, error);
            res.status(500).json({
                success: false,
                error: error.message,
                stack: error.stack,
                platform: process.platform
            });
        }
    });

    // Debug route to test socket connections
    app.get('/debug/sockets', (req, res) => {
        const sockets = [];
        for (const [id, socket] of io.sockets.sockets) {
            sockets.push({
                id: id,
                connected: socket.connected,
                rooms: Array.from(socket.rooms)
            });
        }

        res.json({
            success: true,
            totalSockets: io.engine.clientsCount,
            sockets: sockets,
            activeSessions: Array.from(sessionManager.sessions.keys()),
            sessionCount: sessionManager.sessions.size
        });
    });

    // Debug route to test QR generation flow
    app.post('/debug/test-qr-flow', async (req, res) => {
        try {
            console.log(`Testing QR generation flow...`);

            // Create a test session
            const testUserId = 'debug_user_' + Date.now();
            const testSessionId = sessionManager.getOrCreateSession(testUserId, { test: true });

            console.log(`Created test session: ${testSessionId}`);

            // Check if we can initialize a client (without actually doing it)
            const session = sessionManager.sessions.get(testSessionId);

            res.json({
                success: true,
                message: 'QR flow test initiated',
                testSessionId: testSessionId,
                testUserId: testUserId,
                sessionExists: !!session,
                activeSessions: sessionManager.sessions.size,
                recommendation: 'Check the server logs for detailed debugging info'
            });

            // Clean up test session after 30 seconds
            setTimeout(() => {
                sessionManager.sessions.delete(testSessionId);
                sessionManager.userSessions.delete(testUserId);
                console.log(`Cleaned up test session: ${testSessionId}`);
            }, 30000);

        } catch (error) {
            console.error(`QR flow test failed:`, error);
            res.status(500).json({
                success: false,
                error: error.message,
                stack: error.stack
            });
        }
    });

    // Direct WhatsApp client test endpoint - ISOLATED TEST
    app.post('/debug/test-whatsapp-client', async (req, res) => {
        let testClient = null;
        let qrReceived = false;
        let initSuccess = false;
        let logs = [];

        function log(message) {
            const timestamp = new Date().toISOString();
            const logEntry = `[${timestamp}] ${message}`;
            console.log(`[LOG]: ${logEntry}`);
            logs.push(logEntry);
        }

        try {
            log('Starting isolated WhatsApp client test...');

            // Create minimal test session directory
            const testId = 'isolated_test_' + Date.now();
            const testSessionDir = path.join(__dirname, '../sessions', testId);

            log(`Creating test session directory: ${testSessionDir}`);
            await fs.mkdir(testSessionDir, { recursive: true });

            // Minimal Puppeteer configuration - simplified for testing
            const testPuppeteerOptions = {
                headless: true,
                timeout: 30000,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-web-security'
                ]
            };

            // Add Windows Chrome path if available
            if (process.platform === 'win32') {
                const chromePaths = [
                    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
                ];

                for (const chromePath of chromePaths) {
                    try {
                        await fs.access(chromePath);
                        testPuppeteerOptions.executablePath = chromePath;
                        log(`Using Chrome at: ${chromePath}`);
                        break;
                    } catch (error) {
                        // Chrome not found at this path
                    }
                }
            }

            log('Creating WhatsApp client with minimal configuration...');

            // Create client with minimal configuration
            testClient = new Client({
                authStrategy: new LocalAuth({
                    clientId: testId,
                    dataPath: testSessionDir
                }),
                puppeteer: testPuppeteerOptions
            });

            // Set up QR event handler
            testClient.on('qr', (qr) => {
                qrReceived = true;
                log(`QR CODE RECEIVED! Length: ${qr.length}`);
                log(`QR Preview: ${qr.substring(0, 50)}...`);
            });

            // Set up ready handler
            testClient.on('ready', () => {
                initSuccess = true;
                log('Client is ready!');
            });

            // Set up error handler
            testClient.on('error', (error) => {
                log(`Client error: ${error.message}`);
            });

            // Set up state change handler
            testClient.on('change_state', (state) => {
                log(`State changed to: ${state}`);
            });

            log('Initializing client...');

            // Initialize with timeout
            const initPromise = testClient.initialize();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Test timeout after 20 seconds')), 20000);
            });

            try {
                await Promise.race([initPromise, timeoutPromise]);
                log('Client initialization completed successfully');
            } catch (error) {
                log(`Client initialization failed: ${error.message}`);
            }

            // Wait a bit more for QR if not received
            if (!qrReceived) {
                log('Waiting additional 5 seconds for QR...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }

            // Respond immediately
            res.json({
                success: true,
                testId: testId,
                qrReceived: qrReceived,
                initSuccess: initSuccess,
                logs: logs,
                sessionDir: testSessionDir,
                platform: process.platform,
                message: qrReceived ? 'QR code was generated!' : 'QR code was NOT generated'
            });

            // Clean up after response
            setTimeout(async () => {
                try {
                    if (testClient) {
                        log('Cleaning up test client...');
                        await testClient.destroy();
                    }

                    // Clean up test directory
                    try {
                        await fs.rmdir(testSessionDir, { recursive: true });
                        log('Test session directory cleaned up');
                    } catch (cleanupError) {
                        log(`Cleanup error: ${cleanupError.message}`);
                    }
                } catch (error) {
                    log(`Final cleanup error: ${error.message}`);
                }
            }, 10000);

        } catch (error) {
            log(`Test failed with error: ${error.message}`);

            res.status(500).json({
                success: false,
                error: error.message,
                logs: logs,
                qrReceived: qrReceived,
                initSuccess: initSuccess
            });

            // Clean up on error
            if (testClient) {
                try {
                    await testClient.destroy();
                } catch (destroyError) {
                    log(`Error destroying client: ${destroyError.message}`);
                }
            }
        }
    });

    console.log('Debug routes loaded');
};
