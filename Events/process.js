const axios = require('axios');
const tf = require('@tensorflow/tfjs');
const jpeg = require('jpeg-js');
const png = require('pngjs').PNG;
const extractFrames = require('gif-extract-frames');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const extractFrame = require('ffmpeg-extract-frame');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const DB_PATH = path.join(__dirname, '..', 'DB', 'database.json');

ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);

// --- DATABASE HELPERS (CONFIG) ---
function loadGuildConfig() {
    console.log("Loading guild config from DB_PATH:", DB_PATH);
    try {
        if (fsSync.existsSync(DB_PATH)) {
            const data = fsSync.readFileSync(DB_PATH, 'utf8');
            console.log("Guild config data:", data);
            return JSON.parse(data);
        }
    } catch (e) { 
        console.error("Error loading config:", e);
        return {}; 
    }
    return {};
}
function getAlertChannelId(guildId) {
    console.log("Getting alert channel ID for guild:", guildId);
    const config = loadGuildConfig();
    console.log("Guild config loaded:", config);
    return config[guildId]?.alertChannelId || null;
}
// --- END DATABASE HELPERS (CONFIG) ---

module.exports = (client, model) => {
    // ==========================================
    // UTILITY FUNCTIONS
    // ==========================================

    // Convert Image to Tensor
    async function convertImageToTensor(buffer) {
        let image;

        try {
            image = jpeg.decode(buffer, { useTArray: true });
        } catch (err) {
            try {
                const pngData = await new Promise((resolve, reject) => {
                    new png().parse(buffer, (err, data) => {
                        if (err) reject(err);
                        else resolve(data);
                    });
                });
                image = {
                    width: pngData.width,
                    height: pngData.height,
                    data: pngData.data
                };
            } catch (pngErr) {
                console.error(`[Tensor Conversion Failed] Buffer is neither standard JPG nor PNG.`);
                return null;
            }
        }

        const numChannels = 3;
        const numPixels = image.width * image.height;
        const values = new Int32Array(numPixels * numChannels);

        for (let i = 0; i < numPixels; i++) {
            for (let c = 0; c < numChannels; c++) {
                values[i * numChannels + c] = image.data[i * 4 + c];
            }
        }

        return tf.tensor3d(values, [image.height, image.width, numChannels], 'int32');
    }

    async function checkImage(url) {
        try {
            if (typeof url !== 'string') {
                console.error(`[ERROR] checkImage received non-string:`, typeof url);
                return null;
            }

            console.log(`Attempting to scan URL: ${url}`);
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            const imageTensor = await convertImageToTensor(response.data);

            if (!imageTensor) return null;

            const predictions = await model.classify(imageTensor);
            imageTensor.dispose();
            return predictions;

        } catch (err) {
            console.error("Error scanning static image:", err.message);
            console.error("Failed URL:", url);
            return null;
        }
    }

    async function checkImageBuffer(buffer) {
        try {
            const imageTensor = await convertImageToTensor(buffer);

            if (!imageTensor) return null;

            const predictions = await model.classify(imageTensor);
            imageTensor.dispose();
            return predictions;

        } catch (err) {
            console.error("Error scanning image buffer:", err.message);
            return null;
        }
    }

    async function checkGifFrames(url) {
        const tempDir = path.join(os.tmpdir(), `gif_${Date.now()}`);

        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });

            await fs.mkdir(tempDir, { recursive: true });
            const gifPath = path.join(tempDir, 'temp.gif');
            await fs.writeFile(gifPath, response.data);

            await extractFrames({
                input: gifPath,
                output: path.join(tempDir, 'frame-%d.jpg')
            });

            const files = await fs.readdir(tempDir);
            const frameFiles = files.filter(f => f.startsWith('frame-') && f.endsWith('.jpg'));
            const totalFrames = frameFiles.length;

            if (totalFrames === 0) {
                console.log('[ERROR] No frames extracted from GIF');
                await cleanupTempDir(tempDir);
                return null;
            }

            const framesToCheck = Math.min(Math.floor(Math.random() * 4) + 2, totalFrames);

            console.log(`GIF has ${totalFrames} frames. Checking ${framesToCheck} random frames...`);

            const frameIndices = new Set();
            while (frameIndices.size < framesToCheck) {
                frameIndices.add(Math.floor(Math.random() * totalFrames));
            }

            let highestPornProb = 0;
            let highestHentaiProb = 0;
            let highestSexyProb = 0;

            for (const frameIndex of frameIndices) {
                const framePath = path.join(tempDir, `frame-${frameIndex + 1}.jpg`);

                console.log(`Scanning frame ${frameIndex + 1}/${totalFrames}...`);

                try {
                    await fs.access(framePath);

                    const frameBuffer = await fs.readFile(framePath);
                    const predictions = await checkImageBuffer(frameBuffer);

                    if (predictions) {
                        const porn = predictions.find(p => p.className === 'Porn');
                        const hentai = predictions.find(p => p.className === 'Hentai');
                        const sexy = predictions.find(p => p.className === 'Sexy');

                        if (porn.probability > highestPornProb) highestPornProb = porn.probability;
                        if (hentai.probability > highestHentaiProb) highestHentaiProb = hentai.probability;
                        if (sexy.probability > highestSexyProb) highestSexyProb = sexy.probability;

                        console.log(`Frame ${frameIndex + 1}: P=${porn.probability.toFixed(2)} H=${hentai.probability.toFixed(2)} S=${sexy.probability.toFixed(2)}`);
                    }
                } catch (err) {
                    console.error(`Error reading frame ${frameIndex + 1}:`, err.message);
                }
            }

            console.log(`FINAL HIGHEST: P=${highestPornProb.toFixed(2)} H=${highestHentaiProb.toFixed(2)} S=${highestSexyProb.toFixed(2)}`);

            await cleanupTempDir(tempDir);

            return [
                { className: 'Porn', probability: highestPornProb },
                { className: 'Hentai', probability: highestHentaiProb },
                { className: 'Sexy', probability: highestSexyProb }
            ];

        } catch (err) {
            console.error("Error processing GIF frames:", err.message);
            await cleanupTempDir(tempDir);
            return null;
        }
    }

    async function checkVideoFrames(url) {
        const tempDir = path.join(os.tmpdir(), `video_${Date.now()}`);

        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });

            await fs.mkdir(tempDir, { recursive: true });
            const videoPath = path.join(tempDir, 'temp.mp4');
            await fs.writeFile(videoPath, response.data);

            const duration = await new Promise((resolve, reject) => {
                ffmpeg(videoPath)
                    .ffprobe((err, data) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(data.format.duration);
                        }
                    });
            });

            if (!duration || duration < 1) {
                console.log('[ERROR] Could not determine video duration');
                await cleanupTempDir(tempDir);
                return null;
            }

            console.log(`Video duration: ${duration.toFixed(2)}s`);

            const framesToCheck = Math.min(Math.floor(Math.random() * 4) + 3, 6);
            console.log(`Checking ${framesToCheck} random frames from video...`);

            const timestamps = new Set();
            while (timestamps.size < framesToCheck) {
                const randomTime = Math.random() * (duration - 1); 
                timestamps.add(randomTime);
            }

            let highestPornProb = 0;
            let highestHentaiProb = 0;
            let highestSexyProb = 0;
            let frameCount = 0;

            for (const timestamp of timestamps) {
                frameCount++;
                const framePath = path.join(tempDir, `frame-${frameCount}.jpg`);

                try {
                    console.log(`Extracting frame ${frameCount}/${framesToCheck} at ${timestamp.toFixed(2)}s...`);

                    await new Promise((resolve, reject) => {
                        ffmpeg(videoPath)
                            .screenshots({
                                timestamps: [timestamp],
                                filename: `frame-${frameCount}.jpg`,
                                folder: tempDir,
                                size: '320x?'
                            })
                            .on('end', resolve)
                            .on('error', reject);
                    });

                    await fs.access(framePath);

                    const frameBuffer = await fs.readFile(framePath);
                    const predictions = await checkImageBuffer(frameBuffer);

                    if (predictions) {
                        const porn = predictions.find(p => p.className === 'Porn');
                        const hentai = predictions.find(p => p.className === 'Hentai');
                        const sexy = predictions.find(p => p.className === 'Sexy');

                        if (porn.probability > highestPornProb) highestPornProb = porn.probability;
                        if (hentai.probability > highestHentaiProb) highestHentaiProb = hentai.probability;
                        if (sexy.probability > highestSexyProb) highestSexyProb = sexy.probability;

                        console.log(`Frame ${frameCount} (${timestamp.toFixed(2)}s): P=${porn.probability.toFixed(2)} H=${hentai.probability.toFixed(2)} S=${sexy.probability.toFixed(2)}`);
                    }
                } catch (err) {
                    console.error(`Error processing frame ${frameCount}:`, err.message);
                }
            }

            console.log(`FINAL HIGHEST: P=${highestPornProb.toFixed(2)} H=${highestHentaiProb.toFixed(2)} S=${highestSexyProb.toFixed(2)}`);

            await cleanupTempDir(tempDir);

            return [
                { className: 'Porn', probability: highestPornProb },
                { className: 'Hentai', probability: highestHentaiProb },
                { className: 'Sexy', probability: highestSexyProb }
            ];

        } catch (err) {
            console.error("Error processing video frames:", err.message);
            await cleanupTempDir(tempDir);
            return null;
        }
    }

    async function cleanupTempDir(dir) {
        try {
            const files = await fs.readdir(dir);
            for (const file of files) {
                await fs.unlink(path.join(dir, file));
            }
            await fs.rmdir(dir);
        } catch (err) {
            console.error("Error cleaning up temp directory:", err.message);
        }
    }

    async function blockContent(message, attachmentType, predictions, reason = 'NSFW Detected') {
        const porn = predictions.find(p => p.className === 'Porn');
        const hentai = predictions.find(p => p.className === 'Hentai');
        const sexy = predictions.find(p => p.className === 'Sexy');

        const isNSFW = (porn.probability > 0.60 || hentai.probability > 0.60);
        const isRisky = (sexy.probability > 0.85);

        if (isNSFW || isRisky) {
            try {
                await message.delete();
                const warningMsg = await message.channel.send(`⚠️ **${reason}** \n${message.author}, that ${attachmentType} has been removed by **Apex System**.`);

                console.log(`[BLOCKED] ${message.author.tag} | Type: ${attachmentType} | P: ${porn.probability.toFixed(2)} | H: ${hentai.probability.toFixed(2)} | S: ${sexy.probability.toFixed(2)}`);
                setTimeout(() => warningMsg.delete().catch(() => { }), 5000);
                const alertChannelId = getAlertChannelId(message.guild.id);
                console.log("Alert Channel ID:", alertChannelId, ' Guild ID:', message.guild.id);
                if (alertChannelId) {
                    const alertChannel = message.guild.channels.cache.get(alertChannelId);
                    console.log("Fetched channel:", alertChannel);
                    if (alertChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('🚨 NSFW Content Blocked')
                            .setDescription(`**Sent By:** ${message.author} (${message.author.tag})\n**Reason:** ${reason}`)
                            .addFields(
                                { name: 'Content', value: `[NSFW Content AI Analysis | P : ${porn.probability.toFixed(2)}, H : ${hentai.probability.toFixed(2)}]`, inline: false }
                            )
                            .setColor(0xFF9900)
                            .setTimestamp();
                        await alertChannel.send({ embeds: [logEmbed] });
                    }
                }
                const TIMEOUT_DURATION_MS = 10 * 60 * 1000;
                const TIMEOUT_REASON = 'Automatic anti-nsfw-content punishment : Sharing of NSFW content.';
                if (message.member.manageable && message.member.moderatable) { 
                        await message.member.timeout(TIMEOUT_DURATION_MS, TIMEOUT_REASON);
                }
                return true;
            } catch (err) {
                console.error("Could not delete message. Check bot permissions (Manage Messages!)", err);
                return false;
            }
        }
        return false;
    }

    // ==========================================
    // MESSAGE CREATE EVENT
    // ==========================================

    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        let isBlocked = false;

        if (!message.guild || !message.channel.permissionsFor(client.user).has('ManageMessages')) {
            console.log(`[WARN] Bot lacks 'Manage Messages' permission in ${message.channel.name}. Cannot enforce moderation.`);
        }

        // --- CASE 1: ATTACHMENTS (Images/GIFs/Videos) ---
        if (message.attachments.size > 0) {
            for (const attachment of message.attachments.values()) {
                const contentType = attachment.contentType;
                
                if (contentType?.includes('image')) {
                    let predictions = null;
                    let attachmentType = 'Image';

                    if (contentType.startsWith('image/gif')) {
                        attachmentType = 'GIF Attachment';
                        console.log(`Scanning ${attachmentType} multiple frames from ${message.author.tag}...`);
                        predictions = await checkGifFrames(attachment.url);
                    } else if (contentType.startsWith('image/jpeg') || contentType.startsWith('image/png') || contentType.startsWith('image/webp')) {
                        attachmentType = 'Static Image';
                        console.log(`Scanning ${attachmentType} from ${message.author.tag}...`);
                        console.log(`Attachment URL type: ${typeof attachment.url}`);
                        predictions = await checkImage(attachment.url);
                    }

                    if (predictions && await blockContent(message, attachmentType, predictions)) {
                        isBlocked = true;
                        break;
                    } else if (predictions) {
                        const porn = predictions.find(p => p.className === 'Porn');
                        console.log(`[SAFE] ${attachmentType} passed. P: ${porn.probability.toFixed(2)}`);
                    }
                }
                
                else if (contentType?.includes('video') || attachment.name?.match(/\.(mp4|mov|avi|mkv|webm|flv|wmv)$/i)) {
                    let predictions = null;
                    let attachmentType = 'Video Attachment';
                    
                    console.log(`Scanning ${attachmentType} (${attachment.name}) from ${message.author.tag}...`);
                    predictions = await checkVideoFrames(attachment.url);
                    
                    if (predictions && await blockContent(message, attachmentType, predictions)) {
                        isBlocked = true;
                        break;
                    } else if (predictions) {
                        const porn = predictions.find(p => p.className === 'Porn');
                        console.log(`[SAFE] ${attachmentType} passed. P: ${porn.probability.toFixed(2)}`);
                    }
                }
            }
        }

        if (isBlocked) return;

        // --- CASE 2: STICKERS ---
        if (message.stickers.size > 0) {
            console.log(`Sticker(s) detected. Scanning...`);
            for (const sticker of message.stickers.values()) {
                const stickerUrl = sticker.url || `https://media.discordapp.net/stickers/${sticker.id}.png`;
                console.log(`Sticker URL: ${stickerUrl}`);
                const predictions = await checkImage(stickerUrl);
                if (predictions && await blockContent(message, 'Sticker', predictions)) {
                    isBlocked = true;
                    break;
                }
            }
        }

        if (isBlocked) return;

        // --- CASE 3: EMBED IMAGES/GIFS (Discord GIF Picker, Tenor, Giphy) ---
        // This handles GIFs sent via Discord's built-in GIF picker and link embeds
        if (message.embeds.length > 0) {
            console.log(`Embed(s) detected. Checking for media...`);

            for (const embed of message.embeds) {
                let mediaUrl = null;

                if (embed.image?.url) {
                    mediaUrl = embed.image.url;
                } else if (embed.thumbnail?.url) {
                    mediaUrl = embed.thumbnail.url;
                } else if (embed.video?.url) {
                    mediaUrl = embed.video.url;
                }

                if (!mediaUrl) continue;

                console.log(`Found embed media: ${mediaUrl}`);

                const urlLower = mediaUrl.toLowerCase();
                const isGif = urlLower.includes('.gif');
                const isPng = urlLower.includes('.png');
                const isJpg = urlLower.includes('.jpg') || urlLower.includes('.jpeg');
                const isWebp = urlLower.includes('.webp');
                const isVideo = urlLower.includes('.mp4') || urlLower.includes('.webm') || urlLower.includes('.mov') || urlLower.includes('.avi') || urlLower.includes('.mkv');

                let predictions = null;
                let mediaType = 'Embed Media';

                if (isGif) {
                    mediaType = 'Embed GIF';
                    console.log(`Scanning ${mediaType}...`);
                    predictions = await checkGifFrames(mediaUrl);
                } else if (isVideo) {
                    mediaType = 'Embed Video';
                    console.log(`Scanning ${mediaType}...`);
                    predictions = await checkVideoFrames(mediaUrl);
                } else if (isPng || isJpg || isWebp) {
                    mediaType = 'Embed Image';
                    console.log(`Scanning ${mediaType}...`);
                    predictions = await checkImage(mediaUrl);
                }

                if (predictions && await blockContent(message, mediaType, predictions)) {
                    isBlocked = true;
                    break;
                } else if (predictions) {
                    const porn = predictions.find(p => p.className === 'Porn');
                    console.log(`[SAFE] ${mediaType} passed. P: ${porn.probability.toFixed(2)}`);
                }
            }
        }

        if (isBlocked) return;

        // --- CASE 4: TENOR/GIPHY TEXT LINKS (for backwards compatibility) ---
        // This handles when users paste Tenor/Giphy URLs as text
        const tenorRegex = /(https?:\/\/tenor\.com\/view\/[^\s]+)/i;
        const giphyRegex = /(https?:\/\/giphy\.com\/gifs\/[^\s]+)/i;

        const tenorMatch = message.content.match(tenorRegex);
        const giphyMatch = message.content.match(giphyRegex);

        if (tenorMatch || giphyMatch) {
            console.log(`${tenorMatch ? 'Tenor' : 'Giphy'} link detected in text. Waiting for embed...`);

            await new Promise(resolve => setTimeout(resolve, 2000));

            if (message.embeds.length > 0) {
                for (const embed of message.embeds) {
                    let mediaUrl = embed.image?.url || embed.thumbnail?.url || embed.video?.url;

                    if (!mediaUrl) continue;

                    console.log(`Scanning delayed embed: ${mediaUrl}`);

                    const urlLower = mediaUrl.toLowerCase();
                    const isGif = urlLower.includes('.gif');

                    let predictions = null;

                    if (isGif) {
                        predictions = await checkGifFrames(mediaUrl);
                    } else {
                        predictions = await checkImage(mediaUrl);
                    }

                    if (predictions && await blockContent(message, 'Delayed Embed', predictions)) {
                        return;
                    }
                }
            } else {
                console.log(`[WARN] No embed found after waiting for Tenor/Giphy link.`);
            }
        }
    });

    console.log('[Events] NSFW detection events loaded successfully!');
};