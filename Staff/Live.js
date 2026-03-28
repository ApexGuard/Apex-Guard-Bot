const { EmbedBuilder, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'DB', 'database.json');
const DB_WARNS_PATH = path.join(__dirname, '..', 'DB', 'warns.json');
const DB_WEBHOOKS_PATH = path.join(__dirname, '..', 'DB', 'webhooks.json');
const LIVE_MESSAGE_ID_PATH = path.join(__dirname, '..', 'DB', 'live_message_id.json');

const UPDATE_INTERVAL = 2 * 60 * 60 * 1000;

function loadWarns() {
    try {
        if (fs.existsSync(DB_WARNS_PATH)) {
            const data = fs.readFileSync(DB_WARNS_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) { return {}; }
    return {};
}

function loadWebhooks() {
    try {
        if (fs.existsSync(DB_WEBHOOKS_PATH)) {
            const data = fs.readFileSync(DB_WEBHOOKS_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) { return {}; }
    return {};
}

function loadGuildConfig() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const data = fs.readFileSync(DB_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) { return {}; }
    return {};
}

function getStatistics() {
    const warns = loadWarns();
    const webhooks = loadWebhooks();
    const guildConfig = loadGuildConfig();

    return {
        warnCount: Object.values(warns).reduce((total, userWarns) => total + userWarns.length, 0),
        blacklistedWebhooks: Object.keys(webhooks).length,
        protectedServers: Object.keys(guildConfig).length
    };
}

function loadLiveMessageId() {
    try {
        if (fs.existsSync(LIVE_MESSAGE_ID_PATH)) {
            const data = fs.readFileSync(LIVE_MESSAGE_ID_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) { return {}; }
    return {};
}

function saveLiveMessageId(messageData) {
    try {
        fs.writeFileSync(LIVE_MESSAGE_ID_PATH, JSON.stringify(messageData, null, 2));
    } catch (e) {
        console.error("Failed to save live message ID:", e.message);
    }
}

function createStatsEmbed(stats) {
    return new EmbedBuilder()
        .setTitle('Apex Guard Live Stats')
        .setDescription('Real-time security system statistics')
        .addFields(
            { name: '⚠️ Total Warns', value: `\`${stats.warnCount}\` users warned`, inline: true },
            { name: '🚫 Blacklisted Webhooks', value: `\`${stats.blacklistedWebhooks}\` blocked`, inline: true },
            { name: '🛡️ Protected Servers', value: `\`${stats.protectedServers}\` servers`, inline: true }
        )
        .setColor(0x00AA00)
        .setTimestamp()
        .setFooter({ text: 'Updated every 2 hours' });
}

async function updateLiveStats(client) {
    try {
        const channelId = process.env.LIVE_CHANNEL_ID;
        if (!channelId) {
            console.error('[Live Stats] LIVE_CHANNEL_ID not set in .env');
            return;
        }

        const channel = await client.channels.fetch(channelId);
        if (!channel || channel.type !== ChannelType.GuildText) {
            console.error('[Live Stats] Live channel not found or invalid type');
            return;
        }

        const stats = getStatistics();
        const embed = createStatsEmbed(stats);

        const liveData = loadLiveMessageId();
        const messageId = liveData.messageId;

        if (messageId) {
            try {
                const message = await channel.messages.fetch(messageId);
                await message.edit({ embeds: [embed] });
                console.log(`\n📊 [LIVE STATS] Updated successfully`);
                console.log(`   Warns: ${stats.warnCount} | Webhooks: ${stats.blacklistedWebhooks} | Servers: ${stats.protectedServers}\n`);
            } catch (err) {
                console.log('[Live Stats] Previous message not found, creating new one...');
                const newMessage = await channel.send({ embeds: [embed] });
                saveLiveMessageId({ messageId: newMessage.id });
                console.log(`\n📊 [LIVE STATS] Created new message`);
                console.log(`   Warns: ${stats.warnCount} | Webhooks: ${stats.blacklistedWebhooks} | Servers: ${stats.protectedServers}\n`);
            }
        } else {
            const newMessage = await channel.send({ embeds: [embed] });
            saveLiveMessageId({ messageId: newMessage.id });
            console.log(`\n📊 [LIVE STATS] Created new message`);
            console.log(`   Warns: ${stats.warnCount} | Webhooks: ${stats.blacklistedWebhooks} | Servers: ${stats.protectedServers}\n`);
        }

    } catch (err) {
        console.error('[Live Stats] Error:', err.message);
    }
}

module.exports = (client) => {
    console.log('[Live] Stats system initialized - Updating every 2 hours');

    client.on('clientReady', () => {
        console.log('[Live Stats] Bot ready - Starting first update...');
        updateLiveStats(client);
    });

    setInterval(() => {
        updateLiveStats(client);
    }, UPDATE_INTERVAL);
};
