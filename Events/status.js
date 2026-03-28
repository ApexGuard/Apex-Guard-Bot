const { EmbedBuilder, Routes } = require('discord.js');
const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

// --- DATABASE HELPERS (CONFIG) ---
const DB_PATH = path.join(__dirname, '..', 'DB', 'database.json');

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


// --- AI RESULT CACHE (last 3 unique texts) ---
const STATUS_AI_CACHE = [];
const STATUS_AI_CACHE_MAX = process.env.AI_CACHE_MAX || 3; // You can adjust this if you want to store more results

function statusCacheGet(text) {
    const key = text.trim().toLowerCase();
    const entry = STATUS_AI_CACHE.find(e => e.key === key);
    if (entry) {
        console.log(`[Status AI Cache] Hit for: "${text}" => ${entry.result ? 'UNSAFE' : 'SAFE'}`);
        return { found: true, result: entry.result };
    }
    return { found: false };
}

function statusCacheSet(text, result) {
    const key = text.trim().toLowerCase();
    const idx = STATUS_AI_CACHE.findIndex(e => e.key === key);
    if (idx !== -1) STATUS_AI_CACHE.splice(idx, 1);
    STATUS_AI_CACHE.unshift({ key, result });
    if (STATUS_AI_CACHE.length > STATUS_AI_CACHE_MAX) STATUS_AI_CACHE.pop();
    console.log(`[Status AI Cache] Stored: "${text}" => ${result ? 'UNSAFE' : 'SAFE'} (cache size: ${STATUS_AI_CACHE.length})`);
}
// --- END AI RESULT CACHE ---

module.exports = (client) => {
    const STATUS_RATE_LIMIT = {
        requestTimestamps: [],
        maxRequests: 5,
        windowMs: 60000, 
        queue: []
    };

    function canMakeStatusRequest() {
        const now = Date.now();
        STATUS_RATE_LIMIT.requestTimestamps = STATUS_RATE_LIMIT.requestTimestamps.filter(
            timestamp => now - timestamp < STATUS_RATE_LIMIT.windowMs
        );
        return STATUS_RATE_LIMIT.requestTimestamps.length < STATUS_RATE_LIMIT.maxRequests;
    }

    function recordStatusRequest() {
        STATUS_RATE_LIMIT.requestTimestamps.push(Date.now());
        console.log(`[Status Rate Limit] Request made. Count in last minute: ${STATUS_RATE_LIMIT.requestTimestamps.length}/${STATUS_RATE_LIMIT.maxRequests}`);
    }

    async function processStatusQueue() {
        while (STATUS_RATE_LIMIT.queue.length > 0 && canMakeStatusRequest()) {
            const { text, resolve, reject } = STATUS_RATE_LIMIT.queue.shift();
            recordStatusRequest();
            console.log(`[Status Rate Limit] Processing queued request. Queue remaining: ${STATUS_RATE_LIMIT.queue.length}`);

            try {
                const result = await executeStatusScan(text);
                resolve(result);
            } catch (err) {
                reject(err);
            }
        }
    }

    async function executeStatusScan(text) {
        if (!process.env.GROQ_KEY) {
            console.warn('[AI Scan] GROQ_KEY missing, skipping AI check.');
            return false;
        }

        console.log('[AI Scan] Sending status text to AI:', text);

        let retries = 3;
        let delay = 2000; 

        while (retries > 0) {
            try {
                const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model: 'llama-3.1-8b-instant',
                    messages: [
                        { role: 'system', content: 'You are a strict content moderation AI. Analyze the following user profile text (Status). If it contains NSFW, Hate Speech, Slurs, Sexual Content, or Offensive meaning (even in fancy fonts), reply ONLY "UNSAFE". Otherwise reply "SAFE". Do not explain.' },
                        { role: 'user', content: text }
                    ],
                    temperature: 0.1
                }, {
                    headers: {
                        'Authorization': `Bearer ${process.env.GROQ_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 8000
                });

                const result = response.data.choices[0].message.content.trim().toUpperCase();
                console.log('[AI Scan] Result:', result);
                const isUnsafe = result.includes('UNSAFE');
                statusCacheSet(text, isUnsafe);
                return isUnsafe;

            } catch (err) {
                if (err.response?.status === 429) {
                    retries--;
                    if (retries > 0) {
                        console.warn(`[AI Scan] Rate limited (429). Retrying in ${delay / 1000}s... (${retries} retries left)`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        delay *= 2;
                    } else {
                        console.error('[AI Scan] Rate limited - max retries exceeded. Skipping scan.');
                        return false;
                    }
                } else {
                    console.error('[AI Scan] Error:', err.message);
                    return false;
                }
            }
        }

        return false;
    }

    async function scanuserstatus(text) {
        const cached = statusCacheGet(text);
        if (cached.found) return cached.result;

        if (canMakeStatusRequest()) {
            recordStatusRequest();
            return await executeStatusScan(text);
        }

        console.warn(`[Status Rate Limit] Limit reached (10/min). Queueing request. Queue size: ${STATUS_RATE_LIMIT.queue.length + 1}`);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const index = STATUS_RATE_LIMIT.queue.findIndex(item => item.resolve === resolve);
                if (index !== -1) {
                    STATUS_RATE_LIMIT.queue.splice(index, 1);
                    console.warn('[Status Rate Limit] Request timeout - skipping AI scan');
                    resolve(false);
                }
            }, 30000);

            STATUS_RATE_LIMIT.queue.push({
                text,
                resolve: (result) => {
                    clearTimeout(timeout);
                    resolve(result);
                },
                reject: (err) => {
                    clearTimeout(timeout);
                    reject(err);
                }
            });

            processStatusQueue();
        });
    }

    setInterval(() => {
        processStatusQueue();
    }, 5000);
    // --- END RATE LIMITING SETUP ---

    client.on('presenceUpdate', async (oldPresence, newPresence) => {
        if (!newPresence || !newPresence.member) return;
        if (newPresence.member.user.bot) return;

        const member = newPresence.member;
        const user = member.user;
        const guild = member.guild;
        const userTag = user.tag;
        const username = user.username;
        const globalName = user.globalName || member.displayName;

        const oldActivities = oldPresence?.activities || [];
        const newActivities = newPresence.activities || [];
        const oldStatus = oldActivities.find(a => a.type === 4)?.state || null;
        const newStatus = newActivities.find(a => a.type === 4)?.state || null;

        if (oldStatus !== newStatus && newStatus != null && newStatus !== 'None' && newStatus !== '') {
            console.log(`[Status Update] User: ${userTag}`);
            console.log(`  Old Status: ${oldStatus || 'None'}`);
            console.log(`  New Status: ${newStatus || 'None'}`);

            const isUnsafe = await scanuserstatus(newStatus);
            const detectionReason = 'Unsafe Status';

            if (isUnsafe) {
                console.log(`[Status Alert] Unsafe status detected for user: ${userTag}`);

                try {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('⚠️ Action Required: Inappropriate Profile')
                        .setDescription(`Hi! Your profile has been flagged.\n**Reason:** ${detectionReason}\n\nPlease update your profile to be safe for work (SFW) and rejoin the server.`)
                        .setColor(0xff0000)
                        .setTimestamp();

                    await member.send({ embeds: [dmEmbed] }).catch(() => { });

                    if (member.kickable) {
                        await member.kick(`AutoMod: ${detectionReason}`);
                        console.log(`[AutoMod] Kicked ${userTag} successfully.`);
                    } else {
                        console.log(`[AutoMod] Could not kick ${userTag} (missing permissions).`);
                    }

                    const alertChannelId = getAlertChannelId(guild.id);
                    if (alertChannelId) {
                        const alertChannel = guild.channels.cache.get(alertChannelId);
                        if (alertChannel && alertChannel.isTextBased()) {
                            const logEmbed = new EmbedBuilder()
                                .setTitle('🚨 NSFW User Blocked')
                                .setDescription(`**User:** ${user} (${userTag})\n**Reason:** ${detectionReason}`)
                                .addFields(
                                    { name: 'Username', value: username, inline: false },
                                    { name: 'Display Name', value: globalName || 'N/A', inline: false },
                                    { name: 'Status', value: newStatus || 'N/A', inline: false },
                                    { name: 'About Me', value: 'N/A - This Feature is under development', inline: false }
                                )
                                .setColor(0xFF9900)
                                .setTimestamp();

                            await alertChannel.send({ embeds: [logEmbed] }).catch(err =>
                                console.error('[AutoMod] Failed to send alert:', err)
                            );
                        }
                    }
                } catch (err) {
                    console.error(`[AutoMod] Error processing ${userTag}:`, err);
                }
            }
        }
    });

    console.log('[Events] Status monitoring loaded!');
};