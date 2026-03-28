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
console.log("Apex Protection command module loaded.");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('apexpro')
        .setDescription('Enable or Disable ApexPro External Apps Protection')
        .addStringOption(option =>
            option
                .setName('status')
                .setDescription('Enable or Disable ApexPro External Apps Protection')
                .setRequired(true)
                .addChoices(
                    { name: 'Enable', value: 'enable' },
                    { name: 'Disable', value: 'disable' }
                )
        )
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

    async execute(interaction) {
        const status = interaction.options.getString('status');
        const guild = interaction.guild;

        if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const channels = await guild.channels.fetch();
            let modifiedChannels = 0;
            let failedChannels = 0;

            for (const [, channel] of channels) {
                try {
                    if (channel.type === ChannelType.GuildCategory) continue;

                    const everyoneRole = guild.roles.everyone;

                    if (status === 'enable') {
                        await channel.permissionOverwrites.edit(everyoneRole, {
                            UseExternalApps: false
                        });
                    } else if (status === 'disable') {
                        await channel.permissionOverwrites.edit(everyoneRole, {
                            UseExternalApps: true
                        });
                    }

                    modifiedChannels++;
                } catch (error) {
                    console.error(`Failed to update channel ${channel.name}:`, error);
                    failedChannels++;
                }
            }

            const embed = new EmbedBuilder()
                .setColor(status === 'enable' ? '#FF0000' : '#00FF00')
                .setTitle('ApexPro External Apps Status')
                .setDescription(`Status set to: **${status.toUpperCase()}**`)
                .addFields(
                    { name: 'Channels Modified', value: `${modifiedChannels}`, inline: true },
                    { name: 'Failed', value: `${failedChannels}`, inline: true }
                )
                .setTimestamp();

            if (status === 'enable') {
                embed.addFields({ name: 'Action', value: '🔴 External Apps for @everyone: **DISABLED**' });
            } else {
                embed.addFields({ name: 'Action', value: '🟢 External Apps for @everyone: **ENABLED**' });
            }

            await interaction.editReply({
                embeds: [embed],
                flags: 64
            });
        } catch (error) {
            console.error('ApexPro command error:', error);
            await interaction.editReply({
                content: '❌ An error occurred while processing the command.',
                flags: 64
            });
        }
    }
};
