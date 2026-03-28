const {
    SlashCommandBuilder,
    PermissionsBitField,
    AutoModerationRuleEventType,
    AutoModerationActionType,
    AutoModerationRuleTriggerType,
    AutoModerationRuleKeywordPreset,
    EmbedBuilder,
    ChannelType
} = require('discord.js');
const axios = require('axios'); 
const fs = require('fs');
const path = require('path');
const punishmentCommand = require('./automod_setpunsh');

console.log("Automod command module loaded.");

// --- CONFIG FILE PATH ---
const DB_PATH = path.join(__dirname, '..', 'DB', 'database.json');
// --- END CONFIG FILE PATH ---

// --- PERSISTENCE (DB) FUNCTIONS ---
function loadGuildConfig() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const data = fs.readFileSync(DB_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("Failed to load DB config:", e.message);
    }
    return {};
}

function saveGuildConfig(config) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(config, null, 2));
        return true;
    } catch (e) {
        console.error("Failed to save DB config:", e.message);
        return false;
    }
}

/**
 * Retrieves the Alert Channel ID for the current guild.
 * @param {string} guildId 
 * @returns {string | null}
 */
function getAlertChannelId(guildId) {
    const config = loadGuildConfig();
    return config[guildId]?.alertChannelId || null;
}
// --- END PERSISTENCE (DB) FUNCTIONS ---

// --- EXTERNAL WORD LIST SETUP ---
// BadWords Dictionary URL : https://raw.githubusercontent.com/tural-ali/encycloDB/master/Dirty%20Words/DirtyWords.json / https://raw.githubusercontent.com/3qd4/3qd4DB/refs/heads/main/DirtyWords/main.json
const BAD_WORDS_URL = 'https://raw.githubusercontent.com/3qd4/3qd4DB/refs/heads/main/DirtyWords/main.json';
let CUSTOM_BAD_WORDS = []; // This array will be filled dynamically
const MAX_KEYWORDS_PER_RULE = 1000;
const DISCORD_SETTINGS_GIF_URL = 'https://i.ibb.co/XZhNXqLC/Animation.gif';

/**
 * Downloads and populates the CUSTOM_BAD_WORDS array from the external GitHub URL.
 */
async function fetchCustomBadWords() {
    try {
        const response = await axios.get(BAD_WORDS_URL);

        let data = response.data;

        // Safety Check 1: If data is a string, try to parse it as JSON manually.
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch (e) {
                console.error('[AutoMod ERROR] Failed to parse response data as JSON.');
                return;
            }
        }

        // FIX: Extract the array from the root object's 'RECORDS' key
        let wordRecords = data.RECORDS;

        // Safety Check 2: Ensure the fetched data from RECORDS is an array before mapping.
        if (!Array.isArray(wordRecords)) {
            console.error('[AutoMod ERROR] Fetched data is not an array (missing or invalid "RECORDS" key). Cannot create filter list.');
            return;
        }

        // Map 1: Extract the 'word' string from each object in the array
        const rawWords = wordRecords.map(record => record.word);

        // Map 2: Transform raw words into Discord wildcard format (*word*)
        CUSTOM_BAD_WORDS = rawWords.map(word => `*${word}*`);

        console.log(`[AutoMod] Successfully loaded ${CUSTOM_BAD_WORDS.length} custom bad words from GitHub.`);
    } catch (error) {
        console.error('[AutoMod ERROR] Failed to fetch custom bad words:', error.message);
    }
}
// --- END EXTERNAL WORD LIST SETUP ---

const NSFW_SITES = [
    // --- USER REQUESTED KEYWORDS ---
    '*porn*', '*sex*', '*xxx*', '*xnx*',
    // --- END USER REQUESTED KEYWORDS ---

    // Major Tube Sites
    '*pornhub*', '*xvideos*', '*xnxx*', '*redtube*', '*youporn*',
    '*xhamster*', '*spankbang*', '*eporner*', '*txxx*', '*hqporner*',
    '*tube8*', '*porntube*', '*youjizz*', '*4tube*', '*beeg*',
    '*porn.com*', '*porndig*', '*pornone*', '*pornfun*', '*xxxvideos*',
    '*pornrox*', '*porngo*', '*pornj*', '*porndr*', '*fux*',
    '*xvideos2*', '*xvideos3*', '*xxxstreams*', '*xxxshake*',

    // Cam & Creator Sites
    '*onlyfans*', '*fansly*', '*manyvids*', '*clips4sale*',
    '*chaturbate*', '*cam4*', '*myfreecams*', '*bongacams*',
    '*stripchat*', '*livejasmin*', '*camsoda*', '*camster*',
    '*streamate*', '*camwhores*', '*camrabbit*',

    // Hentai / Animated / Booru
    '*hentai*', '*nhentai*', '*hentaifox*', '*hentaihaven*',
    '*rule34*', '*gelbooru*', '*danbooru*', '*sankaku*',
    '*e621*', '*tbib*', '*realbooru*', '*8muses*', '*f95zone*',

    // Professional Studios & Networks
    '*brazzers*', '*brazzersnetwork*', '*realitykings*', '*mofos*',
    '*teamskeet*', '*teamskeetnetwork*', '*vixen*', '*tushy*',
    '*blacked*', '*blackedraw*', '*babes.com*', '*joymii*',
    '*kink.com*', '*evilangel*', '*digitalplayground*',
    '*naughtyamerica*', '*adulttime*', '*bangbros*', '*bangbrosnetwork*',

    // JAV / Eastern / VR
    '*javhd*', '*javbus*', '*javlibrary*', '*pcs*',
    '*r18.com*', '*heyzo*', '*tokyomotion*', '*caribbeancom*',
    '*1pondo*', '*fc2*',

    // Leaks / Influencers (Legal)
    '*erome*', '*coomer*', '*kemono*', '*fapello*',
    '*thothub*', '*nudostar*', '*leak*', '*leakhive*',
    '*nudogram*', '*celebleaks*', '*mrdeepfakes*',

    // Amateur / Aggregators
    '*xxxstreams*', '*xxxbunker*', '*nuvid*', '*motherless*',
    '*shooshtime*', '*pornbb*', '*pornpics*', '*fuskator*',
    '*imagefap*', '*pornzog*', '*pornkai*', '*pornid*',

    // Fetish / BDSM / Kink
    '*fetlife*', '*bdsm*', '*bondage*', '*swinger*',

    // Misc. Adult Community Sites
    '*suicidegirls*', '*nudevista*', '*nudecollect*',
    '*nudedxxx*', '*nudezz*', '*nudecams*',
    // Addons :
    '*pornhd*',
    '*porn720*',
    '*pornhat*',
    '*porncoil*',
    '*pornburst*',
    '*pornzog*',
    '*pornzoo*',
    '*pornicom*',
    '*porn300*',
    '*pornkai*',
    '*pornrewind*',
    '*pornwhite*',
    '*pornprime*',
    '*porntime*',
    '*pornmate*',
    '*pornvibe*',
    '*porn5*',
    '*pornrewind*',
    '*fuxporn*',
    '*fuxer*',
    '*fuxxx*',
    '*alphaporno*',
    '*voyeurhit*',
    '*xxxluxury*',
    '*xxxmatures*',
    '*xxxmilfs*',
    '*xxxstreams.to*',
    '*xxxaporn*',
    '*xxxfuckvideos*',
    '*xxxcounter*',
    '*xxxvideos247*',
    '*sextube*',
    '*sexvid*',
    '*sexmix*',
    '*sexgalaxy*',
    '*sexkino*',
    '*sexsaoy*',
    '*vipissy*',
    '*viptube*',
    '*vipmembers*',
    '*viptap*',
    '*megaporn*',
    '*megapornfreehd*',
    '*megatube*',
    '*megalust*',
    '*mega-hd-porn*',
    '*nudevista*',
    '*nudedxxx*',
    '*nudezz*',
    '*nudecollect*',
    '*nudedb*',
    '*nudecams*',
    '*nudestar*',
    '*nudespree*',
    '*nudography*',
    '*leak.xxx*',
    '*leakedmodels*',
    '*leakedzone*',
    '*leakgirls*',
    '*leakhub*',
    '*fapworld*',
    '*fapnation*',
    '*faptop*',
    '*fapgod*',
    '*faprun*',
    '*fapvault*',
    '*fapfun*',
    '*fapset*',
    '*fapbang*',
    '*fapland*',
    '*camsfinder*',
    '*camseek*',
    '*camsjoy*',
    '*camshark*',
    '*camfox*',
    '*camsfinder.co*',
    '*camsporn*',
    '*camvideos*',
    '*fetishshrine*',
    '*fetishnetwork*',
    '*bdsmlr*',
    '*bdsmstreak*',
    '*bdsmsexvideos*',
    '*bondagevalley*',
    '*bondagecomixxx*',
    '*hentaidude*',
    '*hentaistream*',
    '*hentaiplay*',
    '*hentaiasmr*',
    '*hentaifromhell*',
    '*hentaidatabase*',
    '*hentairead*',
    '*hentaihub*',
    '*hentaipulse*',
    '*javhub*',
    '*javcl*',
    '*javtiful*',
    '*javseen*',
    '*javfinder*',
    '*javfree*',
    '*jav.guru*',
    '*javfull*',
    '*javstream*',
    '*javcollection*',
    '*maturetube*',
    '*matureporn*',
    '*maturezilla*',
    '*maturecupid*',
    '*maturewomenpics*',
    '*maturemoms*',
    '*youngpornvideos*',
    '*teenmegaworld*',
    '*shooshtime*',
    '*nutaku*',
    '*fuskator*',
    '*imagefap*',
    '*8muses.io*',
    '*rule34video*',
    '*comics18*',
    '*ai-porn*',
    '*deepfakeporn*',
    '*deepfakesxxx*',
    '*ai-generated-porn*',
    '*thisvid*',
    '*pornreactor*',
    '*pornmega*',
    '*fapster*',
    '*porneses*',
    '*famouspornstars*',
    '*omgblog*',
    '*adultislife*',
    '*adulttiptop*',
    '*adultaaa*',
    '*adultreviews*',
    '*bestpornsites*',
    '*theporndude*',
    '*pornmd*',
    '*pornship*',
    '*pornburst.xxx*',
    '*pornseed*',
    '*pornicom*',
    '*pornyteen*',
    '*pornreactor*',
    '*pornlib*',
    '*porn7*',
    '*pornrabbit*',
    '*pornrewind*',
    '*pornhits*',
    '*pornhail*',
    '*pornmegaload*',
    '*pornmega*',
    '*pornplanet*',
    '*pornulus*',
    '*pornotron*',
    '*pornplug*',
    '*pornrewind*',
    '*xxxhub*',
    '*xxxparody*',
    '*xxx69*',
    '*xxxfiles*',
    '*xxxgreen*',
    '*xxxmovies.pro*',
    '*xxxhdvideo*',
    '*xxxpornplay*',
    '*xxxvideosx*',
    '*xxxclip*',
    '*xxx-tube*',
    '*xxxpapa*',
    '*xxxhome*',
    '*sexflix*',
    '*sexlep*',
    '*sexlovers*',
    '*sexfilm*',
    '*sexeModel*',
    '*sexcherie*',
    '*sexasian*',
    '*sexmature*',
    '*sexclinic*',
    '*sexstories*',
    '*sexstories69*',
    '*sexsafer*',
    '*vjav*',
    '*vjav.tv*',
    '*vjavhd*',
    '*vjavmobile*',
    '*spankwire*',
    '*spankingtube*',
    '*spankmonster*',
    '*spankbangparty*',
    '*spankmonster*',
    '*nudeinfluencers*',
    '*nudelive*',
    '*nuders*',
    '*nudepic*',
    '*nuditywiki*',
    '*nudetube*',
    '*nudelust*',
    '*nudebase*',
    '*nudepreview*',
    '*fapme*',
    '*faproulette*',
    '*fapload*',
    '*faprotica*',
    '*fapcat*',
    '*faphub*',
    '*fapspank*',
    '*fapspace*',
    '*fapclub*',
    '*faphero*',
    '*fapforfun*',
    '*camsvids*',
    '*camsfinder.net*',
    '*camstreams*',
    '*camvideos.org*',
    '*camsexvideo*',
    '*camtubex*',
    '*camsex.me*',
    '*cams69*',
    '*camworld*',
    '*fetishnetwork.com*',
    '*fetishbox*',
    '*fetishsex*',
    '*fetishporn*',
    '*fetisheyes*',
    '*footfetishbooru*',
    '*latexheaven*',
    '*swinglifestyle*',
    '*swingers.tube*',
    '*hentaipros*',
    '*hentaicore*',
    '*hentaiplus*',
    '*hentaiera*',
    '*hentaitube*',
    '*hentaiwave*',
    '*hentaiworld*',
    '*hentaiuk*',
    '*hentaihaven.org*',
    '*hentailust*',
    '*javxxx*',
    '*javgg*',
    '*javfinder.sh*',
    '*javhot*',
    '*javbeast*',
    '*javwatch*',
    '*javall*',
    '*javbangers*',
    '*javcrave*',
    '*javmov*',
    '*maturedeepthroat*',
    '*matureladies*',
    '*maturesexvideos*',
    '*maturemagazine*',
    '*maturepornvideos*',
    '*hotmovs*',
    '*hot-sex-tube*',
    '*hotleak*',
    '*hotgirlclub*',
    '*hotpornfile*',
    '*hotnudegirls*',
    '*xart*',
    '*xerasex*',
    '*xerotica*',
    '*xbabe*',
    '*xinvid.com*',
    '*xtapes*',
    '*xamateur*',
    '*xtb.xxx*',
    '*xtime.tv*',
    '*xnudepromos*',
    '*adultguide*',
    '*adultaxe*',
    '*adultlist*',
    '*adultsource*',
    '*adulttaboo*',
    '*adultnode*',
    '*adultplay*',
    '*adultgalaxy*',
    '*adultstreams*',
    '*adultmultimedia*',
    '*wetplace*',
    '*wetgirlnude*',
    '*wetpussy*',
    '*wetboobs*',
    '*celebnip*',
    '*celebnakedclub*',
    '*celebgist*',
    '*celebnudeleaks*',
    '*celebnudehd*',
    '*celebnut*',
    '*celebnaked*',
    '*brazzerporn*',
    '*rkprime*',
    '*mofosex*',
    '*pornpros*',
    '*passion-hd*',
    '*netvideogirls*',
    '*woodmancasting*',
    '*castingxxx*',
    '*castingporn*',
    '*castingcouch*',
    '*thisvid*',
    '*thisporn*',
    '*vidz7*',
    '*vidzplanet*',
    '*videarn*',
    '*videoloves*',
    '*omgxxx*',
    '*omgsex*',
    '*omglol*',
    '*omgporn*',
    '*omglesbian*',
    '*nudedirectory*',
    '*bestnudegirls*',
    '*virtcam*',
    '*virtualporn*',
    '*virtualrealporn*',
    '*vrporn*',
    '*vrbangers*',
    '*vrhush*',
    /// Leaks Websites (illegal)
    '*simpcity.cr*',
    '*onlyleaks.ru*',
    '*leakutopia.com*',
    '*leakworld.org*',
    '*fanslyleaks.com*',
    '*onlyfansleaks.net*',
    '*megaleakz.net*',
];

// Regex pattern for Discord invites (more accurate than wildcards)
const DISCORD_INVITE_REGEX = 'discord(?:\\.com|\\.gg|app\\.com)[\\/invite\\/]?(?:[a-zA-Z0-9\\-]{2,32})';

// --- HELPER FUNCTION: CHANNEL SETUP (Existing) ---
async function ensureAlertChannelExists(interaction) {
    const guild = interaction.guild;
    const clientUser = interaction.client.user;

    const CATEGORY_NAME = '︲Apex Guard';
    const CHANNEL_NAME = '🛑︲automod';

    let category = guild.channels.cache.find(c => c.name === CATEGORY_NAME && c.type === ChannelType.GuildCategory);

    if (!category) {
        category = await guild.channels.create({
            name: CATEGORY_NAME,
            type: ChannelType.GuildCategory,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionsBitField.Flags.ViewChannel],
                },
                {
                    id: clientUser.id,
                    allow: [
                        PermissionsBitField.Flags.ViewChannel,
                        PermissionsBitField.Flags.SendMessages,
                        PermissionsBitField.Flags.EmbedLinks
                    ],
                },
            ],
        });
    }

    let channel = guild.channels.cache.find(c => c.name === CHANNEL_NAME && c.type === ChannelType.GuildText && c.parentId === category.id);

    if (!channel) {
        channel = await guild.channels.create({
            name: CHANNEL_NAME,
            type: ChannelType.GuildText,
            parent: category.id,
        });
    }

    return channel;
}

// --- COMMAND LOGIC: SETUP ALERTS (Existing) ---
async function setupAlerts(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const alertChannel = await ensureAlertChannelExists(interaction);

        // 1. Load, Update, and Save Configuration
        const config = loadGuildConfig();
        config[interaction.guildId] = {
            alertChannelId: alertChannel.id
        };
        saveGuildConfig(config);

        const successEmbed = new EmbedBuilder()
            .setColor('#16ce7f')
            .setTitle('✅ AutoMod Alert Channel Configured')
            .setDescription(`All image and text moderation violations will now be logged to ${alertChannel.toString()}.`)
            .addFields(
                { name: 'Category', value: '`︲Apex Guard`', inline: true },
                { name: 'Channel', value: `\`${alertChannel.name}\``, inline: true },
                { name: 'Permissions', value: 'Only Administrators and the bot can view this channel.', inline: false }
            );

        await interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
        console.error('Failed to set up alert channel:', error);
        await interaction.editReply({
            content: '❌ Failed to create the alert channel or save configuration. Check bot permissions (Manage Channels, Manage Roles).'
        });
    }
}
// --- END COMMAND LOGIC: SETUP ALERTS ---

// Helper function to create custom word blocker
async function createCustomWordBlocker(interaction) {
    const guild = interaction.guild;
    const alertChannelId = getAlertChannelId(guild.id); 

    if (!alertChannelId) {
        return interaction.reply({
            content: '⚠️ **Action Required:** Please run `/automod setup-alerts` first to create the private logging channel before adding rules.',
            ephemeral: true
        });
    }

    if (CUSTOM_BAD_WORDS.length === 0) {
        return interaction.reply({ content: '❌ The custom word list is empty or failed to load.', ephemeral: true });
    }

    const existingRules = await guild.autoModerationRules.fetch();
    const existingApexCustomRules = existingRules.filter(r => r.name.startsWith('Apex | Custom Bad Words -'));

    if (existingApexCustomRules.size > 0) {
        return interaction.reply({ content: `⚠️ Found ${existingApexCustomRules.size} existing **Custom Bad Words** rules. Please use \`/automod remove\` to delete them first.`, ephemeral: true });
    }

    const totalWords = CUSTOM_BAD_WORDS.length;
    const numChunks = Math.ceil(totalWords / MAX_KEYWORDS_PER_RULE);
    const rulePromises = [];

    await interaction.deferReply({ ephemeral: false });

    try {
        for (let i = 0; i < numChunks; i++) {
            const chunk = CUSTOM_BAD_WORDS.slice(i * MAX_KEYWORDS_PER_RULE, (i + 1) * MAX_KEYWORDS_PER_RULE);
            const ruleName = `Apex | Custom Bad Words - Part ${i + 1}/${numChunks}`;

            rulePromises.push(guild.autoModerationRules.create({
                name: ruleName,
                creatorId: interaction.client.user.id,
                eventType: AutoModerationRuleEventType.MessageSend,
                triggerType: AutoModerationRuleTriggerType.Keyword,
                triggerMetadata: { keywordFilter: chunk },
                actions: [
                    {
                        type: AutoModerationActionType.BlockMessage,
                        metadata: { customMessage: `🚫 Apex blocked message (Custom Rule ${i + 1}).` }
                    },
                    {
                        type: AutoModerationActionType.SendAlertMessage,
                        metadata: { channel: alertChannelId }
                    }
                ],
                enabled: true,
                exemptRoles: guild.roles.cache.filter(role => role.permissions.has(PermissionsBitField.Flags.Administrator) || role.permissions.has(PermissionsBitField.Flags.ManageGuild)).map(r => r.id),
            }));
        }

        await Promise.all(rulePromises);

        await interaction.editReply({ content: `✅ **Apex** successfully created **${numChunks}** custom word filters, blocking a total of **${totalWords}** bad words! Alerts sent to <#${alertChannelId}>.` });

    } catch (error) {
        console.error('Failed to create Custom Word Filter:', error);
        await interaction.editReply({ content: '❌ Failed to create the AutoMod rules. Ensure the bot has **Manage Server** permission.' });
    }
}

async function createNSFWSiteBlocker(interaction) {
    const guild = interaction.guild;
    const alertChannelId = getAlertChannelId(guild.id); 

    if (!alertChannelId) {
        return interaction.reply({
            content: '⚠️ **Action Required:** Please run `/automod setup-alerts` first to create the private logging channel before adding rules.',
            ephemeral: true
        });
    }

    const existingRules = await guild.autoModerationRules.fetch();
    const nsfwRule = existingRules.find(r => r.name === 'Apex | Block NSFW Sites');

    if (nsfwRule) {
        return interaction.reply({ content: '⚠️ The **Block NSFW Sites** rule already exists. Use `/automod remove` to delete it first.', ephemeral: true });
    }

    try {
        await guild.autoModerationRules.create({
            name: 'Apex | Block NSFW Sites',
            creatorId: interaction.client.user.id,
            eventType: AutoModerationRuleEventType.MessageSend,
            triggerType: AutoModerationRuleTriggerType.Keyword,
            triggerMetadata: { keywordFilter: NSFW_SITES },
            actions: [
                {
                    type: AutoModerationActionType.BlockMessage,
                    metadata: { customMessage: '🔞 Apex blocked message (NSFW Sites).' }
                },
                {
                    type: AutoModerationActionType.SendAlertMessage,
                    metadata: { channel: alertChannelId } 
                }
            ],
            enabled: true,
            exemptRoles: guild.roles.cache.filter(role => role.permissions.has(PermissionsBitField.Flags.Administrator) || role.permissions.has(PermissionsBitField.Flags.ManageGuild)).map(r => r.id),
        });

        await interaction.reply({ content: `✅ **Apex** successfully created the **Block NSFW Sites** rule. Alerts sent to <#${alertChannelId}>.`, ephemeral: false });

    } catch (error) {
        console.error('Failed to create NSFW blocker:', error);
        await interaction.reply({ content: '❌ Failed to create the AutoMod rule. Ensure the bot has **Manage Server** permission.', ephemeral: true });
    }
}

async function createDiscordInviteBlocker(interaction) {
    const guild = interaction.guild;
    const alertChannelId = getAlertChannelId(guild.id); 

    if (!alertChannelId) {
        return interaction.reply({
            content: '⚠️ **Action Required:** Please run `/automod setup-alerts` first to create the private logging channel before adding rules.',
            ephemeral: true
        });
    }

    const existingRules = await guild.autoModerationRules.fetch();
    const inviteRule = existingRules.find(r => r.name === 'Apex | Block Discord Invites');

    if (inviteRule) {
        return interaction.reply({ content: '⚠️ The **Block Discord Invites** rule already exists. Use `/automod remove` to delete it first.', ephemeral: true });
    }

    try {
        await guild.autoModerationRules.create({
            name: 'Apex | Block Discord Invites',
            creatorId: interaction.client.user.id,
            eventType: AutoModerationRuleEventType.MessageSend,
            triggerType: AutoModerationRuleTriggerType.Keyword,
            triggerMetadata: {
                regexPatterns: [DISCORD_INVITE_REGEX]
            },
            actions: [
                {
                    type: AutoModerationActionType.BlockMessage,
                    metadata: { customMessage: '🔗 Apex blocked message (Discord Invites).' }
                },
                {
                    type: AutoModerationActionType.SendAlertMessage,
                    metadata: { channel: alertChannelId }
                }
            ],
            enabled: true,
            exemptRoles: guild.roles.cache.filter(role => role.permissions.has(PermissionsBitField.Flags.Administrator) || role.permissions.has(PermissionsBitField.Flags.ManageGuild)).map(r => r.id),
        });

        await interaction.reply({ content: `✅ **Apex** successfully created the **Block Discord Invites** rule using regex pattern. Alerts sent to <#${alertChannelId}>.`, ephemeral: false });

    } catch (error) {
        console.error('Failed to create Discord invite blocker:', error);
        await interaction.reply({ content: '❌ Failed to create the AutoMod rule. Ensure the bot has **Manage Server** permission.', ephemeral: true });
    }
}

async function createProfanityFilter(interaction) {
    const guild = interaction.guild;
    const alertChannelId = getAlertChannelId(guild.id); 

    if (!alertChannelId) {
        return interaction.reply({
            content: '⚠️ **Action Required:** Please run `/automod setup-alerts` first to create the private logging channel before adding rules.',
            ephemeral: true
        });
    }

    try {
        const existingRules = await guild.autoModerationRules.fetch();
        const profanityRuleExists = existingRules.some(r => r.triggerType === AutoModerationRuleTriggerType.KeywordPreset);

        const title = profanityRuleExists
            ? '⚠️ Instructions: Profanity Filter Already Exists'
            : '✅ Profanity Filter Setup Instructions';

        const description = profanityRuleExists
            ? 'The Profanity Filter rule is already active in your settings. If it was created by Apex, you may need to manually enable other actions (Alert, Quarantine) via Server Settings > AutoMod.'
            : 'The default Profanity, Sexual Content, and Slurs filters are highly effective but must be **manually created or enabled** by the server owner/admin in Discord’s native settings. This ensures you have full ownership and control over all actions (Alert, Quarantine, etc.).';

        const successEmbed = new EmbedBuilder()
            .setColor('#16ce7f')
            .setTitle(title)
            .setDescription(description)
            .addFields({
                name: 'ACTION REQUIRED:',
                value: 'Please go to **Server Settings** > **AutoMod** to verify or manually enable the default keyword preset filters. '
            })
            .setImage(DISCORD_SETTINGS_GIF_URL)
            .setFooter({ text: 'Go to Server Settings > AutoMod to adjust settings.' });

        await interaction.reply({ embeds: [successEmbed], ephemeral: false });

    } catch (error) {
        console.error('Failed to send Profanity Filter instructions:', error);
        await interaction.reply({ content: '❌ Failed to send the instruction message.', ephemeral: true });
    }
}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('automod')
        .setDescription('Manage Discord AutoMod rules (Requires Manage Server permission)')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a new AutoMod rule')
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('Type of AutoMod rule to create')
                        .setRequired(true)
                        .addChoices(
                            { name: '🔞 Block NSFW/Porn Sites', value: 'nsfw_sites' },
                            { name: '🔗 Block Discord Invites', value: 'discord_invites' },
                            { name: '🚫 Block Profanity (Discord List)', value: 'profanity' },
                            { name: '📝 Block Custom Words (External List)', value: 'custom_words' }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup-alerts')
                .setDescription('Sets up the private alert channel (🛑︲automod) for violations.')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all currently active AutoMod rules')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('punishment')
                .setDescription('Set a AutoMod rule Punishment Action')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove an AutoMod rule by name')
                .addStringOption(option =>
                    option
                        .setName('rule_name')
                        .setDescription('Name of the rule to remove (e.g., Apex | Profanity Filter)')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'This command can only be run inside a server.', ephemeral: true });
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            const type = interaction.options.getString('type');

            switch (type) {
                case 'nsfw_sites':
                    await createNSFWSiteBlocker(interaction);
                    break;
                case 'discord_invites':
                    await createDiscordInviteBlocker(interaction);
                    break;
                case 'profanity':
                    await createProfanityFilter(interaction);
                    break;
                case 'custom_words':
                    await createCustomWordBlocker(interaction);
                    break;
                default:
                    await interaction.reply({ content: '❌ Invalid rule type selected.', ephemeral: true });
            }
        } else if (subcommand === 'setup-alerts') {
            await setupAlerts(interaction);
        } else if (subcommand === 'punishment') {
            await punishmentCommand.execute(interaction);
        } else if (subcommand === 'list') {
            await interaction.deferReply({ ephemeral: true });

            try {
                const rules = await interaction.guild.autoModerationRules.fetch();
                if (rules.size === 0) {
                    return interaction.editReply({ content: '📋 No AutoMod rules found for this server.' });
                }

                let responseText = `**📋 Current AutoMod Rules (${rules.size}):**\n\n`;

                rules.forEach((rule) => {
                    const status = rule.enabled ? '🟢 Enabled' : '🔴 Disabled';
                    const triggerType = Object.keys(AutoModerationRuleTriggerType).find(
                        key => AutoModerationRuleTriggerType[key] === rule.triggerType
                    ) || 'UNKNOWN';

                    responseText += `**${rule.name}**\n`;
                    responseText += `> Status: ${status}\n`;
                    responseText += `> Trigger: \`${triggerType}\`\n`;
                    responseText += `> ID: \`${rule.id}\`\n\n`;
                });

                await interaction.editReply({ content: responseText });

            } catch (error) {
                console.error('Failed to list AutoMod rules:', error);
                await interaction.editReply({
                    content: '❌ Failed to fetch AutoMod rules. Ensure the bot has **Manage Server** permission.'
                });
            }

        } else if (subcommand === 'remove') {
            const ruleName = interaction.options.getString('rule_name');

            await interaction.deferReply({ ephemeral: false });

            try {
                const rules = await interaction.guild.autoModerationRules.fetch();
                const ruleToDelete = rules.find(r => r.name === ruleName);

                if (!ruleToDelete) {
                    return interaction.editReply({
                        content: `❌ No AutoMod rule found with the name: **${ruleName}**\n\nUse \`/automod list\` to see all rules.`
                    });
                }

                await ruleToDelete.delete();
                await interaction.editReply({
                    content: `✅ Successfully deleted the AutoMod rule: **${ruleName}**`
                });

            } catch (error) {
                console.error('Failed to delete AutoMod rule:', error);
                await interaction.editReply({
                    content: '❌ Failed to delete the AutoMod rule. Ensure the bot has **Manage Server** permission.'
                });
            }
        }
    },
};

fetchCustomBadWords();