import {
    SlashCommandBuilder,
    TextDisplayBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ContainerBuilder,
    MessageFlags
} from 'discord.js';

const FEATURES = {
    GENERAL: {
        title: "# 🛡️ Apex Guard – Your Server's Security",
        description: "Apex Guard keeps your server safe 24/7. Here's what we do:\n\n" +
            "📸 **Image Scanner** – Catches NSFW images & GIFs automatically\n" +
            "🦠 **Scam Blocker** – Stops malware links & dangerous files\n" +
            "👤 **Member Safety** – Checks new members for suspicious bios\n\n" +
            "Pick a feature below to learn more or set it up!",
        footer: "-# Choose a feature to get started"
    },
    IMAGE_FILTERING: {
        title: "# 📸 Attachments Scanner",
        description: "We scan every image and GIF for inappropriate content.\n\n" +
            "<a:VERIFIED:1271198200732324043> Works on image attachments & embeds (Tenor, Giphy, etc.)\n" +
            "<a:VERIFIED:1271198200732324043> Checks the GIFs very carefully\n" +
            "<a:VERIFIED:1271198200732324043> Auto-deletes unsafe content & warns the user\n\n" +
            "No setup needed – it works automatically!",
        footer: "-# Back to Home | Choose another feature"
    },
    ANTISCAM_DEFENSE: {
        title: "# 🦠 Scam & Malware Blocker",
        description: "We block phishing links, malware, and scam files.\n\n" +
            "<a:VERIFIED:1271198200732324043> Blocks dangerous file types (.exe, .apk, .ps1, etc.)\n" +
            "<a:VERIFIED:1271198200732324043> Scans links against VirusTotal (malware database)\n" +
            "<a:VERIFIED:1271198200732324043> Catches common scam messages\n\n" +
            "Auto-enabled on all servers. Stay safe!",
        footer: "-# Back to Home | Choose another feature"
    },
    PROFILE_SCANNING: {
        title: "# 👤 Member Safety Check",
        description: "When someone joins, we scan their profile.\n\n" +
            "<a:VERIFIED:1271198200732324043> Checks username, display name...\n" +
            "<a:VERIFIED:1271198200732324043> AI detects suspicious/unsafe content\n" +
            "<a:VERIFIED:1271198200732324043> Auto-warns or kicks if needed\n\n" +
            "We keep your community safe from day one.",
        footer: "-# Back to Home | Choose another feature"
    },
    APEX_DEFENSE: {
        title: "# ⚡ Apex Defense – Advanced Protection",
        description: "Let's detect any violation.\n\n" +
            "<a:VERIFIED:1271198200732324043> Blocks any violationing user profile\n" +
            "<a:VERIFIED:1271198200732324043> Detects webhook exploits and blocks them\n" +
            "<a:VERIFIED:1271198200732324043> Catches any crypto scam (X, Scams)\n\n" +   
            "Auto-enabled on all servers. Stay safe!",
        footer: "-# Back to Home | Choose another feature"
    },
    SETUP: {
        title: "# ⚙️ Getting Started with Apex Guard",
        description: "Setting up Apex Guard is super easy!\n\n" +
            "**Step 1:** Give Apex Guard the right permissions\n" +
            "> Manage Messages, Kick Members, Read History\n\n" +
            "**Step 2:** Use `/setup-alerts` to set up your alert channel\n" +
            "> This is where we send security alerts\n\n" +
            "**Step 3:** Use `/automod add` to set up your server\n" +
            "> Choose which features you want enabled\n\n" +
            "**Step 4:** Use `/automod punishment` to set the punishments\n" +
            "> Block message, Timeout... \n\n" +
            "**That's it!** Your server is now protected.",
        footer: "-# Questions? Check `/help` or join our Support Discord"
    }
};

export const data = new SlashCommandBuilder()
    .setName('help')
    .setDescription('Displays Apex Guard features in a creative menu.');

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // --- Select Menu ---
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("help_select")
        .setPlaceholder("Pick what you want to learn about...")
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel("📸 Image Scanner")
                .setValue("IMAGE_FILTERING")
                .setDescription("How we catch NSFW images"),
            new StringSelectMenuOptionBuilder()
                .setLabel("🦠 Scam Blocker")
                .setValue("ANTISCAM_DEFENSE")
                .setDescription("Stop malware & phishing links"),
            new StringSelectMenuOptionBuilder()
                .setLabel("👤 Member Safety")
                .setValue("PROFILE_SCANNING")
                .setDescription("Check new member profiles"),
            new StringSelectMenuOptionBuilder()
                .setLabel("⚡ Apex Defense")
                .setValue("APEX_DEFENSE")
                .setDescription("Advanced protection features"),
            new StringSelectMenuOptionBuilder()
                .setLabel("⚙️ Setup Guide")
                .setValue("SETUP")
                .setDescription("Get Apex Guard working")
        );

    const selectRow = new ActionRowBuilder().addComponents(selectMenu);

    // --- Buttons ---
    const homeButton = new ButtonBuilder()
        .setCustomId("help_home")
        .setLabel("Home")
        .setEmoji("<:ApexReboot:1453410159995916491>")
        .setStyle(ButtonStyle.Secondary);

    const supportButton = new ButtonBuilder()
        .setLabel("Support Server")
        .setEmoji("<:ApexSupport:1453409747939364957>")
        .setStyle(ButtonStyle.Link)
        .setURL("https://discord.gg/32EAzf7yYS");

    const websiteButton = new ButtonBuilder()
        .setLabel("Dashboard")
        .setEmoji("<:ApexWebsite:1453410231529766965> ")
        .setStyle(ButtonStyle.Link)
        .setURL("https://apexguarddash.netlify.app/");

    const buttonRow = new ActionRowBuilder().addComponents(homeButton, supportButton);

    // --- Initial Container ---
    const createContainer = (featureKey) => {
        const feature = FEATURES[featureKey];

        const header = new TextDisplayBuilder()
            .setContent(feature.title);

        const description = new TextDisplayBuilder()
            .setContent(feature.description);

        const footer = new TextDisplayBuilder()
            .setContent(feature.footer);

        return new ContainerBuilder()
            .setAccentColor(0x16ce7f)
            .addTextDisplayComponents(header, description, footer)
            .addActionRowComponents(selectRow, buttonRow);
    };

    const response = await interaction.editReply({
        components: [createContainer('GENERAL').toJSON()],
        flags: MessageFlags.IsComponentsV2
    });

    // --- Collector ---
    const collector = response.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 120_000
    });

    collector.on("collect", async i => {
        if (i.isStringSelectMenu() && i.customId === "help_select") {
            const featureKey = i.values[0];
            if (!FEATURES[featureKey]) return;

            await i.update({
                components: [createContainer(featureKey).toJSON()],
                flags: MessageFlags.IsComponentsV2
            });
        }

        if (i.isButton() && i.customId === "help_home") {
            await i.update({
                components: [createContainer('GENERAL').toJSON()],
                flags: MessageFlags.IsComponentsV2
            });
        }
    });

    collector.on("end", async () => {
        try {
            const expiredText = new TextDisplayBuilder()
                .setContent("# ⏳ Help Menu Expired\nThis help menu has expired. Use `/help` to open a new one.");

            const expiredContainer = new ContainerBuilder()
                .setAccentColor(0x808080)
                .addTextDisplayComponents(expiredText);

            await interaction.editReply({
                components: [expiredContainer.toJSON()],
                flags: MessageFlags.IsComponentsV2
            });
        } catch { }
    });
}