const { EmbedBuilder, Routes } = require('discord.js');
const axios = require('axios');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const BANNED_WORDS = [
    'camsex', 'hentai', 'whore', 'slut', 'nigger', 'faggot',
    'free nudes', 'sexcum', 'nudes', 'horny', '18+ creator',
    'leaks', 'condo', 'porn', 'pornhub', 'p0rn', '$ex', 'P0rn',
    'F U C K', 'f u c k', 'dick', 'd i c k', 'pussy', 'p u s s y',
    'penis', 'p e n i s', 'vagina', 'v e n i g i n a', 'penis', 'p e n i s',
    '🍆🍑', '🍆 🍑', '🍑🍆', 'nudes', 'nude', 'sexcam', 'leaks', 'condo',
    'onlyfans leaks', 'onlyfans leak', 'onlyfans', 'Spiderman Video', 'spiderman video',
    '5 or ban', 'five or ban', 'noods', 'nudz', 'p00rn', '𝐍𝐮𝐝𝐞𝐬', '𝐒𝐞𝐱𝐭𝐢𝐧𝐠', '𝐒𝐞𝐱𝐂𝐮𝐦',
    'sexcum', 'ₙᵤdₑ', 'ₛₑₓCₐₘ', 'sᴇxᴄᴜᴍ', 'boobs', 'boob', 'bdsm', '𝗛ᴏʀɴʏ', 'horny', '𝗦ᴇxᴄᴜᴍ',
    '💦🍑', '🍑💦', '🍆💦🍑', '🍆💦', '💦🍆',
];

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


// --- RATE LIMITING SETUP ---
const RATE_LIMIT = {
    requestTimestamps: [], 
    maxRequests: 10,
    windowMs: 60000,
    queue: []
};

function canMakeRequest() {
    const now = Date.now();
    RATE_LIMIT.requestTimestamps = RATE_LIMIT.requestTimestamps.filter(
        timestamp => now - timestamp < RATE_LIMIT.windowMs
    );

    return RATE_LIMIT.requestTimestamps.length < RATE_LIMIT.maxRequests;
}

function recordRequest() {
    RATE_LIMIT.requestTimestamps.push(Date.now());
    console.log(`[Rate Limit] Request made. Count in last minute: ${RATE_LIMIT.requestTimestamps.length}/${RATE_LIMIT.maxRequests}`);
}

async function processQueue() {
    while (RATE_LIMIT.queue.length > 0 && canMakeRequest()) {
        const { text, resolve, reject } = RATE_LIMIT.queue.shift();
        recordRequest();
        console.log(`[Rate Limit] Processing queued request. Queue remaining: ${RATE_LIMIT.queue.length}`);

        try {
            const result = await executeAIScan(text);
            resolve(result);
        } catch (err) {
            reject(err);
        }
    }
}

// --- AI RESULT CACHE (last 3 unique texts) ---
const AI_CACHE = [];
const AI_CACHE_MAX = process.env.AI_CACHE_MAX || 3; // U can adjust this if you want to store more results

function cacheGet(text) {
    const key = text.trim().toLowerCase();
    const entry = AI_CACHE.find(e => e.key === key);
    if (entry) {
        console.log(`[AI Cache] Hit for: "${text}" => ${entry.result ? 'UNSAFE' : 'SAFE'}`);
        return { found: true, result: entry.result };
    }
    return { found: false };
}

function cacheSet(text, result) {
    const key = text.trim().toLowerCase();
    const idx = AI_CACHE.findIndex(e => e.key === key);
    if (idx !== -1) AI_CACHE.splice(idx, 1);
    AI_CACHE.unshift({ key, result });
    if (AI_CACHE.length > AI_CACHE_MAX) AI_CACHE.pop();
    console.log(`[AI Cache] Stored: "${text}" => ${result ? 'UNSAFE' : 'SAFE'} (cache size: ${AI_CACHE.length})`);
}
// --- END AI RESULT CACHE ---

async function executeAIScan(text) {
    console.log('[AI Scan] Sending text to AI:', text);

    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.1-8b-instant',
            messages: [
                { role: 'system', content: 'You are a strict content moderation AI. Analyze the following user profile text (Username/Display Name/Status). If it contains NSFW, Hate Speech, Slurs, Sexual Content, or Offensive meaning (even in fancy fonts), reply ONLY "UNSAFE". Otherwise reply "SAFE". Do not explain.' },
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
        cacheSet(text, isUnsafe);
        return isUnsafe;

    } catch (err) {
        console.error('[AI Scan] Error:', err.message);
        return false;
    }
}

// --- AI Scan with Rate Limiting ---
async function scanWithAI(text) {
    if (!process.env.GROQ_KEY) {
        console.warn('[AI Scan] GROQ_KEY missing, skipping AI check.');
        return false;
    }

    const cached = cacheGet(text);
    if (cached.found) return cached.result;

    if (canMakeRequest()) {
        recordRequest();
        return await executeAIScan(text);
    }

    console.warn(`[Rate Limit] Limit reached (10/min). Queueing request. Queue size: ${RATE_LIMIT.queue.length + 1}`);

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            const index = RATE_LIMIT.queue.findIndex(item => item.resolve === resolve);
            if (index !== -1) {
                RATE_LIMIT.queue.splice(index, 1);
                console.warn('[Rate Limit] Request timeout - skipping AI scan');
                resolve(false);
            }
        }, 30000);

        RATE_LIMIT.queue.push({
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

        processQueue();
    });
}

setInterval(() => {
    processQueue();
}, 5000);
// --- END RATE LIMITING SETUP ---

// --- AutoMod Listener ---
module.exports = (client) => {
    client.on('guildMemberAdd', async (member) => {
        if (member.user.bot) return;

        setTimeout(async () => {
            let customStatus = '';
            try {
                const activities = member.presence?.activities || [];
                const statusActivity = activities.find(a => a.type === 4);
                customStatus = statusActivity?.state || '';
            } catch (e) {
                customStatus = '';
            }

            const username = member.user.username;
            const displayName = member.displayName;
            const globalName = member.user.globalName || '';

            // --- Prepare full text for AI ---
            const fullProfileText = `Username: ${username} | Display: ${displayName}` +
                `${customStatus ? ` | Status: ${customStatus}` : ''}` +
                `${globalName ? ` | Global Name: ${globalName}` : ''}`;

            console.log(`[AutoMod] Profile Text Sent to AI: ${fullProfileText}`);

            // --- Fast banned word check (optional) ---
            const foundWord = BANNED_WORDS.find(word =>
                username.toLowerCase().includes(word) ||
                displayName.toLowerCase().includes(word) ||
                globalName.toLowerCase().includes(word)
            );

            let isDetected = !!foundWord;
            let detectionReason = foundWord ? `Profile contains prohibited word (${foundWord})` : '';

            // --- AI Scan if no banned word detected ---
            if (!isDetected && fullProfileText.trim() !== '') {
                const isUnsafeAI = await scanWithAI(fullProfileText);
                if (isUnsafeAI) {
                    isDetected = true;
                    detectionReason = "AI detected offensive/NSFW content (including fancy fonts/ASCII)";
                }
            }

            // --- Enforcement ---
            if (isDetected) {
                console.log(`[AutoMod] User ${member.user.tag} flagged: ${detectionReason}`);
                try {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle('⚠️ Action Required: Inappropriate Profile')
                        .setDescription(`Hi! Your profile has been flagged.\n**Reason:** ${detectionReason}\n\nPlease update your profile to be safe for work (SFW) and rejoin the server.`)
                        .setColor(0xff0000)
                        .setTimestamp();

                    await member.send({ embeds: [dmEmbed] }).catch(() => { });

                    if (member.kickable) {
                        await member.kick(`AutoMod: ${detectionReason}`);
                        console.log(`[AutoMod] Kicked ${member.user.tag} successfully.`);
                    } else {
                        console.log(`[AutoMod] Could not kick ${member.user.tag} (missing permissions).`);
                    }
                    const alertChannelId = getAlertChannelId(member.guild.id);
                    if (alertChannelId) {
                        const alertChannel = member.guild.channels.cache.get(alertChannelId);
                        if (alertChannel && alertChannel.isTextBased()) {
                            const logEmbed = new EmbedBuilder()
                                .setTitle('🚨 NSFW User Blocked')
                                .setDescription(`**User:** ${member.user} (${member.user.tag})\n**Reason:** ${detectionReason}`)
                                .addFields(
                                    { name: 'Username', value: member.user.username, inline: false },
                                    { name: 'Display Name', value: `${globalName}` || 'N/A', inline: false },
                                    { name: 'Status', value: customStatus || 'N/A', inline: false },
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
                    console.error(`[AutoMod] Error processing ${member.user.tag}:`, err);
                }
            } else {
                console.log(`[AutoMod] User ${member.user.tag} joined and passed profile check.`);
            }
        }, 3000); 
    });
};
