const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());


// Get Puppeteer configuration for WhatsApp Web
function getPuppeteerConfig() {
    return {
        headless: 'new',
        executablePath: puppeteer.executablePath(),
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        ]
    };
}


// Get minimal fallback Puppeteer configuration
function getFallbackPuppeteerConfig() {
    return {
        headless: true,
        executablePath: puppeteer.executablePath(),
        timeout: 20000,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        ]
    };
}

// Get test Puppeteer configuration for debugging
function getTestPuppeteerConfig() {
    return {
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
}

// Get basic Puppeteer launch config for testing
function getBasicPuppeteerConfig() {
    return {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    };
}

module.exports = {
    puppeteer,
    getPuppeteerConfig,
    getFallbackPuppeteerConfig,
    getTestPuppeteerConfig,
    getBasicPuppeteerConfig
};
