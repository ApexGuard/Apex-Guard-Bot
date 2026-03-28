const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const probe = require('probe-image-size');

// --- CONFIGURATION ---
const DB_PATH = path.join(__dirname, '..', 'DB', 'database.json');
const DB_WARNS_PATH = path.join(__dirname, '..', 'DB', 'warns.json');

const KNOWN_SCAM_HASHES = new Set([
    '23f931ad14b369699cbfbf485b7ebd6540a9922a',
    '3ae303fe3bd6ea39d27d8837619d8105c36aa56f'
]);

const SCAM_WIDTH_MIN = 637;
const SCAM_WIDTH_MAX = 655;
const SCAM_HEIGHT_MIN = 851;
const SCAM_HEIGHT_MAX = 873;

const RISK_THRESHOLD = 7;
const TIMEOUT_DURATION_MS = 15 * 60 * 1000;
const AUTO_BAN_WARNS = 3;

// --- DATABASE HELPERS ---
function loadGuildConfig() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const data = fs.readFileSync(DB_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) { return {}; }
    return {};
}

function getAlertChannelId(guildId) {
    const config = loadGuildConfig();
    return config[guildId]?.alertChannelId || null;
}

function loadWarns() {
    try {
        if (fs.existsSync(DB_WARNS_PATH)) {
            const data = fs.readFileSync(DB_WARNS_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) { return {}; }
    return {};
}

function saveWarns(warnsData) {
    try {
        fs.writeFileSync(DB_WARNS_PATH, JSON.stringify(warnsData, null, 2));
        return true;
    } catch (e) {
        console.error("Failed to save warns DB:", e.message);
        return false;
    }
}

function addWarn(userId, reason) {
    const warnsData = loadWarns();
    if (!warnsData[userId]) {
        warnsData[userId] = [];
    }
    warnsData[userId].push({
        reason: reason,
        timestamp: new Date().toISOString()
    });
    saveWarns(warnsData);
    return warnsData[userId].length;
}

function getWarnCount(userId) {
    const warnsData = loadWarns();
    return warnsData[userId] ? warnsData[userId].length : 0;
}

// --- UTILITY FUNCTIONS ---

async function generateImageHash(imageUrl) {
    try {
        const response = await axios.get(imageUrl, { 
            responseType: 'arraybuffer',
            timeout: 5000 
        });
        return crypto.createHash('sha1').update(response.data).digest('hex');
    } catch (err) {
        console.error(`[AntiCrypto] Failed to hash image:`, err.message);
        return null;
    }
}

async function getImageDimensions(imageUrl) {
    try {
        const size = await probe(imageUrl);
        return {
            width: size.width,
            height: size.height
        };
    } catch (err) {
        console.error(`[AntiCrypto] Failed to get image dimensions:`, err.message);
        return null;
    }
}

function isSuspiciousDimension(width, height) {
    return (
        width >= SCAM_WIDTH_MIN && width <= SCAM_WIDTH_MAX &&
        height >= SCAM_HEIGHT_MIN && height <= SCAM_HEIGHT_MAX
    );
}

function getAccountAgeDays(user) {
    const createdAt = user.createdAt;
    const now = new Date();
    const ageMs = now - createdAt;
    return ageMs / (1000 * 60 * 60 * 24);
}

async function calculateRiskScore(message, attachments) {
    let score = 0;
    const hashes = [];
    const imageInfos = [];
    let knownScamFound = false;

    const hashPromises = attachments.map(att => generateImageHash(att.url));
    const generatedHashes = await Promise.all(hashPromises);

    for (let i = 0; i < attachments.length; i++) {
        const hash = generatedHashes[i];
        const attachment = attachments[i];
        if (hash) {
            hashes.push({ url: attachment.url, hash });
            if (KNOWN_SCAM_HASHES.has(hash)) {
                knownScamFound = true;
            }
        }
    }

    if (knownScamFound) {
        console.log(`[AntiCrypto] ⚠️ KNOWN SCAM HASH DETECTED!`);
        return { score: RISK_THRESHOLD + 5, imageInfos, hashes, isKnownScam: true };
    }

    if (attachments.length === 4) {
        score += 3;
    }

    let suspiciousImageCount = 0;
    const dimPromises = attachments.map(att => getImageDimensions(att.url));
    const dims = await Promise.all(dimPromises);

    for (let i = 0; i < dims.length; i++) {
        if (dims[i]) {
            imageInfos.push({
                url: attachments[i].url,
                width: dims[i].width,
                height: dims[i].height,
                isSuspicious: isSuspiciousDimension(dims[i].width, dims[i].height)
            });
            if (isSuspiciousDimension(dims[i].width, dims[i].height)) {
                suspiciousImageCount++;
            }
        }
    }

    if (suspiciousImageCount >= 2) {
        score += 3;
    }

    const uniqueHashes = new Set(hashes.map(h => h.hash));
    if (uniqueHashes.size < hashes.length) {
        score += 4;
    }

    if (getAccountAgeDays(message.author) < 14) {
        score += 2;
    }

    if (message.member && message.member.roles.cache.size === 0) {
        score += 1;
    }

    return { score, imageInfos, hashes };
}

async function blockScamMessage(message, riskScore, imageInfos, hashes) {
    try {
        await message.delete();

        const warningMsg = await message.channel.send(
            `🚨 **SCAM DETECTED** \n${message.author}, your message has been removed by **Apex Anti-Scam System**.\nReason: Image-only suspicious content (Score: ${riskScore})`
        );
        setTimeout(() => warningMsg.delete().catch(() => {}), 5000);

        const warnCount = addWarn(message.author.id, `[Anti-Scam] Image spam - Risk Score: ${riskScore}`);
        console.log(`[AntiCrypto] User ${message.author.tag} received warn #${warnCount}`);

        if (message.member.moderatable) {
            await message.member.timeout(TIMEOUT_DURATION_MS, `[Anti-Scam] Suspicious image spam (Risk Score: ${riskScore})`);
            console.log(`[AntiCrypto] Timed out ${message.author.tag} for ${TIMEOUT_DURATION_MS / 1000}s`);
        }

        if (warnCount >= AUTO_BAN_WARNS) {
            if (message.member.bannable) {
                await message.guild.members.ban(message.author.id, {
                    reason: `[Anti-Scam Auto-Ban] ${warnCount} scam violations`
                });
                console.log(`[AntiCrypto] AUTO-BANNED ${message.author.tag} after ${warnCount} warns`);
            }
        }

        const alertChannelId = getAlertChannelId(message.guild.id);
        if (alertChannelId) {
            const alertChannel = message.guild.channels.cache.get(alertChannelId);
            if (alertChannel) {
                let imageDetails = '';
                for (let i = 0; i < hashes.length; i++) {
                    const hash = hashes[i];
                    imageDetails += `[Image ${i + 1}](${hash.url})\n\`${hash.hash}\`\n\n`;
                }

                const logEmbed = new EmbedBuilder()
                    .setTitle('🚨 SCAM BLOCKED - Image Spam')
                    .setDescription(`**User:** ${message.author} (${message.author.tag})\n**Guild:** ${message.guild.name}`)
                    .addFields(
                        { name: 'Risk Score', value: `${riskScore}/${RISK_THRESHOLD}`, inline: true },
                        { name: 'Warn Count', value: `${warnCount}/${AUTO_BAN_WARNS}`, inline: true },
                        { name: 'Account Age', value: `${getAccountAgeDays(message.author).toFixed(1)} days`, inline: true },
                        { name: '🖼️ Scam Images & Hashes', value: imageDetails || 'N/A', inline: false }
                    )
                    .setColor(0xFF0000)
                    .setTimestamp();

                if (warnCount >= AUTO_BAN_WARNS) {
                    logEmbed.addFields({ name: '⚠️ ACTION', value: `AUTO-BANNED after ${warnCount} violations`, inline: false });
                }

                await alertChannel.send({ embeds: [logEmbed] });
            }
        }

    } catch (err) {
        console.error(`[AntiCrypto] Error blocking message:`, err.message);
    }
}

// --- EVENT HANDLER ---
module.exports = (client) => {
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        if (!message.guild) return;
        if (!message.channel.permissionsFor(client.user).has('ManageMessages')) return;

        try {
            const imageAttachments = Array.from(message.attachments.values()).filter(att => {
                const contentType = att.contentType;
                return contentType && (
                    contentType.includes('image/jpeg') ||
                    contentType.includes('image/png') ||
                    contentType.includes('image/webp')
                );
            });

            if (imageAttachments.length === 4 && message.content.trim().length === 0) {
                console.log(`[AntiCrypto] Scanning 4-image message from ${message.author.tag}...`);

                const { score, imageInfos, hashes, isKnownScam } = await calculateRiskScore(message, imageAttachments);
                if (isKnownScam) {
                    console.log(`[AntiCrypto] KNOWN SCAM DETECTED! Blocking immediately...`);
                }

                if (score >= RISK_THRESHOLD) {
                    console.log(`[AntiCrypto] ⚠️ SCAM DETECTED! Score: ${score}`);
                    await blockScamMessage(message, score, imageInfos, hashes);
                }
            }

        } catch (err) {
            console.error(`[AntiCrypto] Error in message handler:`, err.message);
        }
    });

    console.log('[Events] Anti-Crypto scam detection loaded successfully!');
};