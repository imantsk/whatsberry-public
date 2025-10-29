const fs = require('fs').promises;
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { execSync } = require('child_process');
const { AUDIO_CONVERSION_TTL, AUDIO_BITRATE, AUDIO_FREQUENCY, AUDIO_CHANNELS, AUDIO_CONVERSION_TIMEOUT } = require('../config/constants');

class AudioConverter {
    constructor(audioConversionDir) {
        this.audioConversionCache = new Map(); // mediaId -> { filePath, timestamp, originalSize, convertedSize }
        this.audioConversionTTL = AUDIO_CONVERSION_TTL;
        this.audioConversionDir = audioConversionDir || path.join(__dirname, '../audio_cache');

        // FFmpeg settings
        this.ffmpegPath = null;
        this.ffmpegAvailable = false;

        // Initialize FFmpeg
        this.initializeFFmpeg();
    }

    // Initialize audio conversion directory
    async initializeAudioCache() {
        try {
            await fs.mkdir(this.audioConversionDir, { recursive: true });
            console.log(`Audio conversion cache directory initialized: ${this.audioConversionDir}`);
        } catch (error) {
            console.error('Failed to create audio conversion directory:', error);
        }
    }

    // Initialize FFmpeg with multiple fallback methods
    async initializeFFmpeg() {
        console.log('Initializing FFmpeg...');

        // Method 1: Try @ffmpeg-installer/ffmpeg package
        try {
            const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
            this.ffmpegPath = ffmpegInstaller.path;
            console.log(`Found FFmpeg via installer package: ${this.ffmpegPath}`);
        } catch (error) {
            console.log('@ffmpeg-installer/ffmpeg not available');
        }

        // Method 2: Try system FFmpeg
        if (!this.ffmpegPath) {
            try {
                // Check if ffmpeg is in PATH
                if (process.platform === 'win32') {
                    execSync('where ffmpeg', { stdio: 'ignore' });
                    this.ffmpegPath = 'ffmpeg';
                } else {
                    execSync('which ffmpeg', { stdio: 'ignore' });
                    this.ffmpegPath = 'ffmpeg';
                }
                console.log('Found system FFmpeg in PATH');
            } catch (error) {
                console.log('System FFmpeg not found in PATH');
            }
        }

        // Method 3: Try common installation paths
        if (!this.ffmpegPath) {
            const commonPaths = process.platform === 'win32' ? [
                'C:\\ffmpeg\\bin\\ffmpeg.exe',
                'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
                'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe'
            ] : [
                '/usr/bin/ffmpeg',
                '/usr/local/bin/ffmpeg',
                '/opt/ffmpeg/bin/ffmpeg',
                '/snap/bin/ffmpeg'
            ];

            for (const testPath of commonPaths) {
                try {
                    const fs = require('fs');
                    if (fs.existsSync(testPath)) {
                        this.ffmpegPath = testPath;
                        console.log(`Found FFmpeg at: ${testPath}`);
                        break;
                    }
                } catch (error) {
                    // Continue to next path
                }
            }
        }

        // Test FFmpeg functionality
        if (this.ffmpegPath) {
            try {
                ffmpeg.setFfmpegPath(this.ffmpegPath);

                // Simple test to check if FFmpeg responds to version command
                try {
                    execSync(`"${this.ffmpegPath}" -version`, {
                        stdio: 'pipe',
                        timeout: 5000
                    });
                    this.ffmpegAvailable = true;
                    console.log('FFmpeg is working correctly.');
                } catch (versionError) {
                    console.log(`FFmpeg version test failed: ${versionError.message}`);
                    this.ffmpegAvailable = false;
                }
            } catch (error) {
                console.log(`FFmpeg test failed: ${error.message}`);
                this.ffmpegAvailable = false;
            }
        } else {
            console.log('FFmpeg not found! Audio conversion will be disabled.');
        }
    }

    // Clean up expired audio conversion cache
    async cleanupAudioCache() {
        const now = Date.now();
        let cleanedCount = 0;
        let freedSpace = 0;

        for (const [mediaId, cacheInfo] of this.audioConversionCache.entries()) {
            if (now - cacheInfo.timestamp > this.audioConversionTTL) {
                try {
                    // Delete the converted file
                    await fs.unlink(cacheInfo.filePath);
                    freedSpace += cacheInfo.convertedSize || 0;
                    this.audioConversionCache.delete(mediaId);
                    cleanedCount++;
                } catch (error) {
                    // File might already be deleted, just remove from cache
                    this.audioConversionCache.delete(mediaId);
                }
            }
        }

        if (cleanedCount > 0) {
        }
    }

    // Check if audio needs conversion and get conversion cache key
    needsAudioConversion(mimetype) {
        const audioFormatsNeedingConversion = [
            'audio/ogg',
            'audio/opus',
            'audio/webm',
            'audio/aac',
            'audio/m4a',
            'audio/wav',
            'audio/flac'
        ];

        // Handle MIME types with parameters (like "audio/ogg; codecs=opus")
        const baseMimetype = mimetype.toLowerCase().split(';')[0].trim();
        return audioFormatsNeedingConversion.includes(baseMimetype);
    }

    // Get supported output formats for a given input mimetype
    getSupportedFormats(mimetype) {
        const formats = ['original']; // Always support original format

        if (mimetype.startsWith('audio/') && this.ffmpegAvailable) {
            formats.push('mp3');
        }

        return formats;
    }

    // Validate requested format
    isValidFormat(format, mimetype) {
        const supportedFormats = this.getSupportedFormats(mimetype);
        return supportedFormats.includes(format);
    }

    // Convert audio to MP3
    async convertAudioToMp3(inputBuffer, originalMimetype, mediaId) {
        // Check if FFmpeg is available
        if (!this.ffmpegAvailable) {
            throw new Error('FFmpeg is not available on this server. Please install FFmpeg to enable audio conversion.');
        }

        return new Promise(async (resolve, reject) => {
            try {
                // Check cache first
                const cacheEntry = this.audioConversionCache.get(mediaId);
                if (cacheEntry && (Date.now() - cacheEntry.timestamp < this.audioConversionTTL)) {
                    console.log(`Using cached MP3 conversion for: ${mediaId}`);
                    const cachedBuffer = await fs.readFile(cacheEntry.filePath);
                    return resolve(cachedBuffer);
                }

                await this.initializeAudioCache();

                // Generate unique file names
                const inputFileName = `input_${mediaId}.${this.getFileExtension(originalMimetype)}`;
                const outputFileName = `output_${mediaId}.mp3`;
                const inputPath = path.join(this.audioConversionDir, inputFileName);
                const outputPath = path.join(this.audioConversionDir, outputFileName);

                console.log(`Converting audio to MP3: ${mediaId} (${originalMimetype})`);

                // Write input buffer to temporary file
                await fs.writeFile(inputPath, inputBuffer);

                // Convert using FFmpeg
                const ffmpegCommand = ffmpeg(inputPath);

                ffmpegCommand
                    .audioBitrate(AUDIO_BITRATE)
                    .audioFrequency(AUDIO_FREQUENCY)
                    .audioChannels(AUDIO_CHANNELS)
                    .audioCodec('libmp3lame')
                    .format('mp3')
                    .on('start', (commandLine) => {
                        console.log(`FFmpeg started: ${commandLine}`);
                    })
                    .on('progress', (progress) => {
                        if (progress.percent) {
                            console.log(`Conversion progress: ${Math.round(progress.percent)}%`);
                        }
                    })
                    .on('end', async () => {
                        try {
                            console.log(`Audio conversion completed: ${mediaId}`);

                            // Read the converted file
                            const convertedBuffer = await fs.readFile(outputPath);
                            const stats = await fs.stat(outputPath);

                            // Cache the conversion
                            this.audioConversionCache.set(mediaId, {
                                filePath: outputPath,
                                timestamp: Date.now(),
                                originalSize: inputBuffer.length,
                                convertedSize: stats.size
                            });

                            // Clean up input file
                            try {
                                await fs.unlink(inputPath);
                            } catch (cleanupError) {
                                console.log(`Input file cleanup warning: ${cleanupError.message}`);
                            }

                            resolve(convertedBuffer);

                        } catch (readError) {
                            console.error(`Error reading converted file: ${readError.message}`);
                            reject(readError);
                        }
                    })
                    .on('error', async (error) => {
                        console.error(`FFmpeg conversion error: ${error.message}`);

                        // Clean up files on error
                        try {
                            await fs.unlink(inputPath);
                        } catch (cleanupError) {
                            // Ignore cleanup errors
                        }
                        try {
                            await fs.unlink(outputPath);
                        } catch (cleanupError) {
                            // Ignore cleanup errors
                        }

                        reject(new Error(`Audio conversion failed: ${error.message}`));
                    })
                    .output(outputPath)
                    .run();

                // Set a timeout for conversion
                const conversionTimeout = setTimeout(() => {
                    try {
                        ffmpegCommand.kill('SIGKILL');
                    } catch (killError) {
                        console.log(`Could not kill FFmpeg process: ${killError.message}`);
                    }
                    reject(new Error(`Audio conversion timeout after ${AUDIO_CONVERSION_TIMEOUT / 1000} seconds`));
                }, AUDIO_CONVERSION_TIMEOUT);

                // Clear timeout on completion
                ffmpegCommand.on('end', () => {
                    clearTimeout(conversionTimeout);
                });

                ffmpegCommand.on('error', () => {
                    clearTimeout(conversionTimeout);
                });

            } catch (error) {
                console.error(`Audio conversion setup error: ${error.message}`);
                reject(error);
            }
        });
    }

    // Get file extension from MIME type
    getFileExtension(mimetype) {
        const extensions = {
            'audio/ogg': 'ogg',
            'audio/ogg; codecs=opus': 'ogg',
            'audio/opus': 'opus',
            'audio/webm': 'webm',
            'audio/aac': 'aac',
            'audio/m4a': 'm4a',
            'audio/wav': 'wav',
            'audio/flac': 'flac',
            'audio/mpeg': 'mp3',
            'audio/mp3': 'mp3'
        };

        // Handle MIME types with parameters (like "audio/ogg; codecs=opus")
        const baseMimetype = mimetype.toLowerCase().split(';')[0].trim();
        return extensions[mimetype.toLowerCase()] || extensions[baseMimetype] || 'audio';
    }

    // Get cache statistics
    getCacheStats() {
        let totalSize = 0;
        let totalOriginalSize = 0;

        for (const [, cacheInfo] of this.audioConversionCache.entries()) {
            totalSize += cacheInfo.convertedSize || 0;
            totalOriginalSize += cacheInfo.originalSize || 0;
        }

        return {
            cacheSize: this.audioConversionCache.size,
            totalConvertedSize: totalSize,
            totalOriginalSize: totalOriginalSize,
            compressionRatio: totalOriginalSize > 0 ? (totalSize / totalOriginalSize).toFixed(2) : 0,
            ttl: this.audioConversionTTL
        };
    }
}

module.exports = AudioConverter;
