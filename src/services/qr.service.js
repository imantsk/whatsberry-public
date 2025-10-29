const qrcode = require('qrcode');

/**
 * Generate QR code as data URL from QR string
 * @param {string} qr - QR code string from WhatsApp
 * @returns {Promise<string>} Data URL of QR code image
 */
async function generateQRCode(qr) {
    try {
        const qrCodeDataURL = await qrcode.toDataURL(qr);
        return qrCodeDataURL;
    } catch (error) {
        throw new Error(`Failed to generate QR code: ${error.message}`);
    }
}

module.exports = {
    generateQRCode
};
