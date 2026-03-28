const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'DB', 'database.json');
const DB_BLOCKED_WEBHOOKS_PATH = path.join(__dirname, '..', 'DB', 'webhooks.json');

const WHITELISTED_WEBHOOKS = new Set([
    '1330904821074628679'
]);

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

function loadBlockedWebhooks() {
    try {
        if (fs.existsSync(DB_BLOCKED_WEBHOOKS_PATH)) {
            const data = fs.readFileSync(DB_BLOCKED_WEBHOOKS_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) { return {}; }
    return {};
}

function saveBlockedWebhooks(blockedData) {
    try {
        fs.writeFileSync(DB_BLOCKED_WEBHOOKS_PATH, JSON.stringify(blockedData, null, 2));
        return true;
    } catch (e) {
        console.error("Failed to save blocked webhooks:", e.message);
        return false;
    }
}

function blockWebhook(webhookId, webhookName, guildId) {
    const blocked = loadBlockedWebhooks();
    if (!blocked[webhookId]) {
        blocked[webhookId] = {
            name: webhookName,
            guildId: guildId,
            blockedAt: new Date().toISOString(),
            attempts: 0
        };
    } else {
        blocked[webhookId].attempts++;
    }
    saveBlockedWebhooks(blocked);
    console.log(`[ApexProtection] Webhook ID ${webhookId} added to blocklist`);
}

function isWebhookBlocked(webhookId) {
    const blocked = loadBlockedWebhooks();
    return blocked[webhookId] ? true : false;
}

function isWebhookWhitelisted(webhookId) {
    return WHITELISTED_WEBHOOKS.has(webhookId);
}

module.exports = (client) => {
    client.on('messageCreate', async (message) => {
        try {
            if (message.webhookId) {
                const timestamp = new Date().toISOString();

                if (isWebhookWhitelisted(message.webhookId)) {
                    console.log(`\n✅ [WHITELISTED WEBHOOK]`);
                    console.log(`   Webhook ID: ${message.webhookId}`);
                    console.log(`   Author: ${message.author.username}`);
                    console.log(`   Guild: ${message.guild.name}`);
                    console.log(`   Status: ALLOWED (Whitelisted)\n`);
                    return;
                }

                if (isWebhookBlocked(message.webhookId)) {
                    console.log(`\n🚫 [BLOCKED WEBHOOK ATTEMPT]`);
                    console.log(`   Webhook ID: ${message.webhookId}`);
                    console.log(`   Author: ${message.author.username}`);
                    console.log(`   Guild: ${message.guild.name}`);
                    console.log(`   Status: MESSAGE DELETED (BlackListed)\n`);

                    await message.delete();

                    const alertChannelId = getAlertChannelId(message.guild.id);
                    if (alertChannelId) {
                        const alertChannel = message.guild.channels.cache.get(alertChannelId);
                        if (alertChannel) {
                            const blockedEmbed = new EmbedBuilder()
                                .setTitle('🚫 BLOCKED WEBHOOK ATTEMPT')
                                .setDescription(`A previously blocked webhook tried to post in **${message.channel.name}**`)
                                .addFields(
                                    { name: 'Webhook ID', value: `\`${message.webhookId}\``, inline: true },
                                    { name: 'Webhook Name', value: `${message.author.username}`, inline: true },
                                    { name: 'Status', value: '✅ BlackListed & Deleted', inline: true }
                                )
                                .setColor(0xFF6600)
                                .setTimestamp();

                            await alertChannel.send({ embeds: [blockedEmbed] });
                        }
                    }
                    return;
                }
                
                let isAuthorizedWebhook = false;
                let webhookOwner = null;

                try {
                    const guildWebhooks = await message.guild.fetchWebhooks();
                    const webhook = guildWebhooks.find(w => w.id === message.webhookId);
                    
                    if (webhook) {
                        isAuthorizedWebhook = true;
                        webhookOwner = webhook.owner?.username || 'Unknown';
                    } else if (message.author.bot) {
                        try {
                            const member = await message.guild.members.fetch(message.author.id);
                            if (member) {
                                isAuthorizedWebhook = true;
                                webhookOwner = message.author.username;
                            }
                        } catch (err) {
                            isAuthorizedWebhook = false;
                        }
                    }
                } catch (err) {
                    console.error(`[ApexProtection] Failed to fetch webhooks:`, err.message);
                }

                if (!isAuthorizedWebhook) {
                    console.log(`\n🚨 [UNAUTHORIZED WEBHOOK DETECTED]`);
                    console.log(`   Webhook ID: ${message.webhookId}`);
                    console.log(`   Author: ${message.author.username}#${message.author.discriminator}`);
                    console.log(`   Guild: ${message.guild.name} (${message.guild.id})`);
                    console.log(`   Channel: ${message.channel.name} (${message.channel.id})`);
                    console.log(`   Content: ${message.content}`);
                    console.log(`   Status: MESSAGE DELETED & WEBHOOK BLOCKED\n`);

                    blockWebhook(message.webhookId, message.author.username, message.guild.id);

                    let culpritUser = null;
                    let triggerUser = null;
                    let actionsTaken = ['✅ Message deleted', '✅ Webhook blocked'];

                    if (message.interaction && message.interaction.user) {
                        triggerUser = message.interaction.user;
                        console.log(`   🎯 Interaction Trigger Found: ${triggerUser.username} (${triggerUser.id})`);
                    }

                    if (message.interactionMetadata && message.interactionMetadata.user) {
                        triggerUser = message.interactionMetadata.user;
                        console.log(`   🎯 Interaction Metadata User Found: ${triggerUser.username} (${triggerUser.id})`);
                    }

                    try {
                        const channelWebhooks = await message.channel.fetchWebhooks();
                        const webhook = channelWebhooks.find(w => w.id === message.webhookId);
                        
                        if (webhook && webhook.owner) {
                            culpritUser = webhook.owner;
                            console.log(`   🎯 Webhook Owner Found: ${culpritUser.username} (${culpritUser.id})`);
                        }
                    } catch (webhookErr) {
                        console.log(`   ⚠️ Could not fetch webhook owner: ${webhookErr.message}`);
                    }

                    const targetUser = triggerUser || culpritUser;

                    if (targetUser) {
                        try {
                            const dmEmbed = new EmbedBuilder()
                                .setTitle('🚨 You have been caught in 4K')
                                .setDescription(`You were caught using an unauthorized webhook in **${message.guild.name}**`)
                                .addFields(
                                    { name: 'Server', value: message.guild.name, inline: true },
                                    { name: 'Channel', value: message.channel.name, inline: true },
                                    { name: 'Consequence', value: '🔨 **BANNED**', inline: false }
                                )
                                .setColor(0xFF0000)
                                .setTimestamp()
                                .setFooter({ text: 'Apex Protection System' });

                            await targetUser.send({ embeds: [dmEmbed] });
                            console.log(`   📩 DM sent to ${targetUser.username}`);
                            actionsTaken.push(`✅ DM sent to ${targetUser.username}`);
                        } catch (dmErr) {
                            console.log(`   ⚠️ Could not DM user: ${dmErr.message}`);
                            actionsTaken.push(`⚠️ Could not DM user (DMs closed)`);
                        }

                        try {
                            const member = await message.guild.members.fetch(targetUser.id);
                            if (member) {
                                await message.guild.members.ban(targetUser.id, {
                                    deleteMessageSeconds: 7 * 24 * 60 * 60, 
                                    reason: `[Apex Protection] Caught using unauthorized webhook in #${message.channel.name}`
                                });
                                console.log(`   🔨 User ${targetUser.username} BANNED & messages deleted`);
                                actionsTaken.push(`✅ User ${targetUser.username} BANNED`);
                                actionsTaken.push(`✅ Deleted 7 days of messages from ${targetUser.username}`);
                            }
                        } catch (banErr) {
                            console.log(`   ⚠️ Could not ban user: ${banErr.message}`);
                            actionsTaken.push(`⚠️ Could not ban user: ${banErr.message}`);
                        }
                    }

                    try {
                        await message.delete();
                    } catch (delErr) {
                        console.log(`   ⚠️ Could not delete message: ${delErr.message}`);
                    }

                    const alertChannelId = getAlertChannelId(message.guild.id);
                    if (alertChannelId) {
                        const alertChannel = message.guild.channels.cache.get(alertChannelId);
                        if (alertChannel) {
                            const alertEmbed = new EmbedBuilder()
                                .setTitle('🚨 UNAUTHORIZED WEBHOOK DETECTED & BLOCKED')
                                .setDescription(`An external webhook tried to post in **${message.channel.name}**`)
                                .addFields(
                                    { name: 'Webhook ID', value: `\`${message.webhookId}\``, inline: true },
                                    { name: 'Webhook Name', value: `${message.author.username}`, inline: true },
                                    { name: 'Channel', value: `${message.channel.name}`, inline: true },
                                    { name: 'Triggered By', value: triggerUser ? `<@${triggerUser.id}> (${triggerUser.username})` : 'Unknown', inline: true },
                                    { name: 'Webhook Owner', value: culpritUser ? `<@${culpritUser.id}> (${culpritUser.username})` : 'Unknown', inline: true },
                                    { name: 'Target User', value: targetUser ? `<@${targetUser.id}> (${targetUser.username})` : 'No user found', inline: true },
                                    { name: 'Attempted Content', value: message.content.substring(0, 1024) || 'No content', inline: false },
                                    { name: 'Actions Taken', value: actionsTaken.join('\n'), inline: false }
                                )
                                .setColor(0xFF0000)
                                .setTimestamp();

                            await alertChannel.send({ embeds: [alertEmbed] });
                        }
                    }
                } else {
                    console.log(`\n🪝 [WEBHOOK MESSAGE DETECTED - AUTHORIZED]`);
                    console.log(`   Webhook ID: ${message.webhookId}`);
                    console.log(`   Author: ${message.author.username}#${message.author.discriminator}`);
                    console.log(`   Owner: ${webhookOwner}`);
                    console.log(`   Guild: ${message.guild.name} (${message.guild.id})`);
                    console.log(`   Channel: ${message.channel.name} (${message.channel.id})`);
                    console.log(`   Content: ${message.content}`);
                    console.log(`   Timestamp: ${timestamp}\n`);
                }
            }
        } catch (err) {
            console.error(`[ApexProtection] Error in webhook handler:`, err.message);
        }
    });
    console.log('[Events] Apex Protection webhook detector loaded successfully!');
};
