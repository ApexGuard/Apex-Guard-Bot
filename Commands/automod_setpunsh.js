const {
    SlashCommandBuilder,
    PermissionsBitField,
    AutoModerationRuleEventType,
    AutoModerationActionType,
    AutoModerationRuleTriggerType,
    AutoModerationRuleKeywordPreset,
    EmbedBuilder,
    ChannelType,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
console.log("Automod punishment command module loaded.");

module.exports = {
    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'This command can only be run inside a server.', flags: 64 });
        }

        await showExistingRulesList(interaction);
    },
};

async function showExistingRulesList(interaction) {
    await interaction.deferReply({ flags: 64 });

    try {
        const rules = await interaction.guild.autoModerationRules.fetch();

        if (rules.size === 0) {
            return interaction.editReply({
                content: '❌ No AutoMod rules found in this server. Create rules first using `/automod add`.'
            });
        }

        const editableRules = rules.filter(rule => rule.name.startsWith('Apex |'));

        if (editableRules.size === 0) {
            return interaction.editReply({
                content: '⚠️ No **Apex** AutoMod rules found. Discord\'s built-in rules (Profanity, Sexual Content) can only be configured by admins in Server Settings > AutoMod.\n\nCreate custom rules using `/automod add` first.'
            });
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_rule_for_punishment')
            .setPlaceholder('Select a rule to add punishment...')
            .addOptions(
                editableRules.map(rule => ({
                    label: rule.name,
                    value: rule.id,
                    description: `ID: ${rule.id.substring(0, 8)}... | ${rule.enabled ? '🟢 Enabled' : '🔴 Disabled'}`,
                    emoji: rule.name.includes('NSFW') ? '🔞' :
                        rule.name.includes('Invite') ? '🔗' :
                            rule.name.includes('Profanity') ? '🚫' :
                                rule.name.includes('Custom') ? '📝' : '⚙️'
                }))
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📋 Select a Rule')
            .setDescription(`Found ${editableRules.size} editable rule(s). Select one to add punishment actions:`)
            .addFields(
                {
                    name: '⚠️ Note',
                    value: 'Discord\'s built-in keyword presets (Profanity, Sexual Content) can only be configured by server admins in Server Settings > AutoMod',
                    inline: false
                }
            );

        await interaction.editReply({ embeds: [embed], components: [row] });

        const collector = interaction.channel.createMessageComponentCollector({
            filter: i => i.customId === 'select_rule_for_punishment' && i.user.id === interaction.user.id,
            time: 60000
        });

        collector.on('collect', async (i) => {
            const selectedRuleId = i.values[0];
            const selectedRule = editableRules.get(selectedRuleId);
            await showPunishmentActionSelection(i, selectedRule);
        });

        collector.on('end', (collected) => {
            if (collected.size === 0) {
                interaction.editReply({ content: '⏱️ Selection timed out.', components: [] });
            }
        });

    } catch (error) {
        console.error('Failed to fetch AutoMod rules:', error);
        await interaction.editReply({
            content: '❌ Failed to fetch AutoMod rules. Ensure the bot has **Manage Server** permission.'
        });
    }
}

async function showPunishmentActionSelection(interaction, selectedRule) {
    const actionButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`action_block_${selectedRule.id}`)
            .setLabel('🚫 Block Message Only')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`action_timeout5_${selectedRule.id}`)
            .setLabel('⏱️ Block + 5min Timeout')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`action_custom_${selectedRule.id}`)
            .setLabel('⚙️ Custom Timeout')
            .setStyle(ButtonStyle.Secondary)
    );

    const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('Select Punishment Action')
        .setDescription(`**Rule:** ${selectedRule.name}\n\nChoose what action to take when violations are detected:`);

    await interaction.update({ embeds: [embed], components: [actionButtons] });

    const buttonCollector = interaction.channel.createMessageComponentCollector({
        filter: i => i.customId.startsWith('action_') && i.customId.includes(selectedRule.id) && i.user.id === interaction.user.id,
        time: 60000
    });

    buttonCollector.on('collect', async (i) => {
        if (i.customId.startsWith('action_custom_')) {
            await showTimeoutModal(i, selectedRule);
        } else if (i.customId.startsWith('action_block_')) {
            await updateRuleWithPunishment(i, selectedRule, null);
        } else if (i.customId.startsWith('action_timeout5_')) {
            await updateRuleWithPunishment(i, selectedRule, 300);
        }
    });

    buttonCollector.on('end', (collected) => {
        if (collected.size === 0) {
            interaction.editReply({ content: '⏱️ Selection timed out.', components: [] });
        }
    });
}

async function showTimeoutModal(interaction, selectedRule) {
    const modal = new ModalBuilder()
        .setCustomId(`timeout_modal_${selectedRule.id}`)
        .setTitle('Custom Timeout Duration');

    const timeoutInput = new TextInputBuilder()
        .setCustomId('timeout_minutes')
        .setLabel('Timeout Duration (in minutes)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., 10 for 10 minutes')
        .setRequired(true);

    const actionRow = new ActionRowBuilder().addComponents(timeoutInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);

    const submitted = await interaction.awaitModalSubmit({
        filter: i => i.customId === `timeout_modal_${selectedRule.id}` && i.user.id === interaction.user.id,
        time: 300000
    }).catch(() => null);

    if (submitted) {
        const timeoutMinutes = parseInt(submitted.fields.getTextInputValue('timeout_minutes'));
        if (isNaN(timeoutMinutes) || timeoutMinutes < 0 || timeoutMinutes > 43200) {
            return submitted.reply({
                content: '❌ Invalid timeout duration. Please provide a number between 0 and 43200 minutes (30 days).',
                flags: 64
            });
        }
        const timeoutSeconds = timeoutMinutes * 60;
        await updateRuleWithPunishment(submitted, selectedRule, timeoutSeconds);
    }
}

async function updateRuleWithPunishment(interaction, selectedRule, timeoutDuration) {
    await interaction.deferReply({ flags: 64 });

    try {
        const actions = createPunishmentActions(timeoutDuration);

        await selectedRule.edit({
            actions: actions
        });

        const actionText = timeoutDuration === null
            ? '🚫 Block Message Only'
            : timeoutDuration === 300
                ? '⏱️ Block Message + 5 Minute Timeout'
                : `⏱️ Block Message + ${Math.floor(timeoutDuration / 60)} Minute Timeout`;

        const successEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('✅ Rule Updated Successfully!')
            .addFields(
                { name: 'Rule Name', value: selectedRule.name, inline: true },
                { name: 'Action', value: actionText, inline: true },
                { name: 'Rule ID', value: selectedRule.id, inline: false }
            );

        await interaction.editReply({ embeds: [successEmbed] });

    } catch (error) {
        console.error('Failed to update AutoMod rule:', error);
        await interaction.editReply({
            content: `❌ Failed to update rule. Ensure the bot has **Manage Server** permission.\n\`\`\`${error.message}\`\`\``
        });
    }
}

function createPunishmentActions(timeoutDuration) {
    const actions = [
        {
            type: AutoModerationActionType.BlockMessage,
            metadata: {
                customMessage: 'This message violates server rules and has been blocked.'
            }
        }
    ];

    if (timeoutDuration !== null && timeoutDuration > 0) {
        actions.push({
            type: AutoModerationActionType.Timeout,
            metadata: {
                durationSeconds: timeoutDuration
            }
        });
    }

    return actions;
}