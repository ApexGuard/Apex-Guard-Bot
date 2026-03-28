const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const DB_PATH = path.join(__dirname, '..', 'DB', 'database.json');
const DB_WARNS_PATH = path.join(__dirname, '..', 'DB', 'warns.json');

const BLOCKED_EXTENSIONS = [
    '.exe', '.scr', '.cpl', '.docm', '.jar', '.vbs', '.wsf', 
    '.js', '.ps1', '.bat', '.cmd', '.msi', '.apk'
];

const SCAM_REGEXES = [
    /free\s*steam\s*\$?(50|100)/i,
    /steam\s*community\s*giveaway/i,
    /discord\s*nitro\s*free/i,
    /free\s*nitro\s*generator/i,
    /airdrop\s*crypto/i,
    /claim\s*your\s*prize/i,
    /gift\s*card\s*giveaway/i,
    /i\s*am\s*leaving\s*cs:?go/i,
    /\bfree\s+nitro\b/i,
    /discord(?:-nitro|-gift|-promo)?\.(?:xyz|gift|store|fun|top|shop)\b/i,
    /steam(?:community|powered|inventory|wallet)[\-\._a-z0-9]{0,20}\.(?:xyz|top|fun|shop|store|lol|online|space|icu|tk|cf|ga|gq)\b/i,
    /claim\s+your\s+(?:free\s+)?(steam|discord|nitro|gift|crypto|bitcoin|ethereum|wallet)\s+(?:gift\s+)?(?:card|code|offer|prize)/i,
    /st[e3]amc(?:o|0)mmunity\.(?:com|net|xyz|top|store)\b/i,
];

// --- DATABASE HELPERS (CONFIG) ---
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
// --- END DATABASE HELPERS (CONFIG) ---


// --- DATABASE HELPERS (WARNINGS) ---
function loadWarns() {
    try {
        if (fs.existsSync(DB_WARNS_PATH)) {
            const data = fs.readFileSync(DB_WARNS_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) { 
        console.error("Failed to load warns DB:", e.message);
    }
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

/**
 * Clears all warning records for a specific user ID.
 * @param {string} userId 
 */
function clearWarns(userId) {
    const warnsData = loadWarns();
    if (warnsData[userId]) {
        delete warnsData[userId];
        saveWarns(warnsData);
        return true;
    }
    return false;
}
// --- END DATABASE HELPERS (WARNINGS) ---


// --- SCANNING FUNCTIONS ---

async function scanLinkWithVirusTotal(url) {
    if (!process.env.VIRUSTOTAL_API_KEY) return false;
    const sanitizedUrl = url.replace(/[.,]*$/, '');
    try {
        const urlId = Buffer.from(sanitizedUrl).toString('base64').replace(/=/g, '');
        
        const response = await axios.get(`https://www.virustotal.com/api/v3/urls/${urlId}`, {
            headers: { 'x-apikey': process.env.VIRUSTOTAL_API_KEY }
        });

        const stats = response.data.data.attributes.last_analysis_stats;
        if (stats.malicious >= 2 || stats.suspicious >= 2) {
            return { isUnsafe: true, details: `VirusTotal: ${stats.malicious} vendors flagged this link.` };
        }
    } catch (err) {
        if (err.response?.status !== 404) {
            console.error('[AntiScam] VirusTotal Error:', err.message);
        }
    }
    return { isUnsafe: false };
}

// --- MAIN HANDLER ---
module.exports = (client) => {
    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.guild) return;
        if (message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        let isDetected = false;
        let reason = '';
        const contentLower = message.content.toLowerCase();
        for (const regex of SCAM_REGEXES) {
            if (regex.test(contentLower)) {
                isDetected = true;
                reason = 'Text matches known scam pattern (e.g. Free Steam/Nitro)';
                break;
            }
        }
        if (!isDetected && message.attachments.size > 0) {
            for (const attachment of message.attachments.values()) {
                const ext = path.extname(attachment.name).toLowerCase();
                if (BLOCKED_EXTENSIONS.includes(ext)) {
                    isDetected = true;
                    reason = `Dangerous file type detected (${ext})`;
                    break;
                }
            }
        }
        if (!isDetected) {
            const rawUrlRegex = /(https?:\/\/[^\s()]+|\bwww\.[^\s()]+)/gi;
            const markdownUrlRegex = /\[.*?\]\((https?:\/\/[^)]+)\)/gi; 
            
            let urls = [];
            
            const rawMatches = message.content.match(rawUrlRegex);
            if (rawMatches) {
                urls = urls.concat(rawMatches);
            }
            
            const markdownMatches = [...message.content.matchAll(markdownUrlRegex)];
            if (markdownMatches) {
                markdownMatches.forEach(match => {
                    if (match[1]) urls.push(match[1]);
                });
            }

            urls = [...new Set(urls)].filter(url => url.length > 5);

            if (urls.length > 0) {
                for (const url of urls) {
                    const scanResult = await scanLinkWithVirusTotal(url);
                    if (scanResult && scanResult.isUnsafe) {
                        isDetected = true;
                        reason = scanResult.details;
                        break;
                    }
                }
            }
        }

        // --- ENFORCEMENT ---
        if (isDetected) {
            try {
                const warnCount = addWarn(message.author.id, reason);
                let punishmentMessage = '';
                
                const TIMEOUT_DURATION_MS = 5 * 60 * 1000;
                const TIMEOUT_REASON = 'Automatic anti-scam punishment: Repeated sharing of malicious content/spam.';

                if (warnCount >= 3) {
                    if (message.member.manageable && message.member.moderatable) { 
                        await message.member.timeout(TIMEOUT_DURATION_MS, TIMEOUT_REASON);
                        clearWarns(message.author.id);
                        punishmentMessage = `🚨 User reached ${warnCount} warnings and has been timed out for 5 minutes. Warnings reset.`;
                    } else {
                        punishmentMessage = `🚨 User reached ${warnCount} warnings but could not be timed out (missing permissions). Warnings still reset.`;
                        clearWarns(message.author.id); 
                    }
                }
                
                if (message.deletable) await message.delete();

                const dmEmbed = new EmbedBuilder()
                    .setTitle('🛡️ Security Alert')
                    .setDescription(`Your message was removed because it was flagged as unsafe.\n**Reason:** ${reason}\n\n${punishmentMessage}`)
                    .setFooter({ text: punishmentMessage ? `- Apex Guard Powerd By 3qd4` : `You now have ${warnCount} warnings.`})
                    .setColor(0xff0000);
                
                await message.author.send({ embeds: [dmEmbed] }).catch(() => {});

                const alertChannelId = getAlertChannelId(message.guild.id);
                if (alertChannelId) {
                    const alertChannel = message.guild.channels.cache.get(alertChannelId);
                    if (alertChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('🚨 Scam/Malware Blocked' + (punishmentMessage ? ' + TIMEOUT' : ''))
                            .setDescription(`**User:** ${message.author} (${message.author.tag})\n**Reason:** ${reason}`)
                            .addFields(
                                { name: 'Content', value: message.content.substring(0, 1000) || '[Media/File Only]', inline: false },
                                { name: 'Warnings', value: warnCount.toString(), inline: true }
                            )
                            .setColor(punishmentMessage ? 0xFF9900 : 0xFF0000)
                            .setTimestamp();
                        
                        await alertChannel.send({ embeds: [logEmbed] });
                    }
                }
                
                console.log(`[AntiScam] Blocked message from ${message.author.tag}. Warns: ${warnCount}. ${punishmentMessage}`);

            } catch (err) {
                console.error('[AntiScam] Enforcement failed:', err);
            }
        }
    });
};