require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType, Collection } = require('discord.js');
const nsfwjs = require('nsfwjs');
const path = require('path');
const fs = require('fs');
const maintenance = true;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});

client.commands = new Collection();

let model;

async function loadModel() {
    console.log("Loading NSFWJS model...");
    model = await nsfwjs.load('InceptionV3');
    console.log("Model loaded successfully!");
    return model;
}

loadModel().then((loadedModel) => {
    const processIndex = require('./Events/process');
    processIndex(client, loadedModel);
    const usersEvent = require('./Events/users');
    usersEvent(client);
    const antiscamEvent = require('./Events/antiscam');
    antiscamEvent(client);
    const statusEvent = require('./Events/status');
    statusEvent(client);
    const AntiCryptoEvent = require('./Events/anticrypto');
    AntiCryptoEvent(client);
    const ApexProtection = require('./Events/ApexProtection');
    ApexProtection(client);

    const ApexBackup = require('./Staff/Apex');
    ApexBackup(client);

    const LiveStats = require('./Staff/Live');
    LiveStats(client);

    client.on('clientReady', () => {
        console.log(`Logged in as ${client.user.tag}! Bot is ready.`);
        if (maintenance) {
            client.user.setPresence({
                activities: [{ name: 'Under Maintenance', type: ActivityType.Streaming, url: 'https://discord.gg/qJT9UsdbCf' }],
                status: 'idle'
            });
        }
        else {
            client.user.setPresence({
                activities: [{ name: 'Monitoring content', type: ActivityType.Watching }],
                status: 'dnd'
            });
        }
    });

    const commandsPath = path.join(__dirname, 'Commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    console.log(`Loading ${commandFiles.length} command(s)...`);

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);

        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            console.log(`✓ Loaded command: ${command.data.name}`);
        } else {
            console.log(`⚠ Skipping ${file}: missing 'data' or 'execute' property`);
        }
    }

    console.log("All command modules loaded.");

    client.on('interactionCreate', async interaction => {
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);

        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            const replyOptions = { content: "There was an error running this command.", ephemeral: true };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(replyOptions);
            } else {
                await interaction.reply(replyOptions);
            }
        }
    });

    client.login(process.env.DISCORD_TOKEN);
}).catch(err => {
    console.error("Failed to load model:", err);
    process.exit(1);
});