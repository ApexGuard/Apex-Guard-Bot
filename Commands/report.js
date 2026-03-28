import {
  SlashCommandBuilder,
  TextDisplayBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ContainerBuilder,
  MessageFlags,
  WebhookClient,
  EmbedBuilder
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('report')
  .setDescription('Report a user to the Apex Guard Safety & Support team.')
  .addUserOption(option => option
    .setName('user')
    .setDescription('The user to report')
    .setRequired(true))
  .addStringOption(option => option
    .setName('reason')
    .setDescription('The reason for reporting the user')
    .setRequired(true))
  .addStringOption(option => option
    .setName('message_link')
    .setDescription('A link to a message or evidence related to the report')
    .setRequired(true))
  .addStringOption(option => option
    .setName('attachment_link')
    .setDescription('A link to an attachment (screenshot, image, etc.)')
    .setRequired(false));

export async function execute(interaction) {
  await interaction.deferReply({ flags: 64 });

  const reportedUser = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason');
  const messageLink = interaction.options.getString('message_link');
  const attachmentLink = interaction.options.getString('attachment_link');

  if (!messageLink && !attachmentLink) {
    await interaction.editReply({
      content: "❌ **You can't report without evidence!**\nPlease provide at least a message link or an attachment link.",
      flags: 64
    });
    return;
  }

  let messageContent = null;
  
if (messageLink) {
  try {
    const urlMatch = messageLink.match(/\/channels\/(\d+)\/(\d+)\/(\d+)/);
    if (urlMatch) {
      const [, guildId, channelId, messageId] = urlMatch;
      
      if (guildId !== interaction.guildId) {
        messageContent = '[Message is from a different server]';
      } else {
        const channel = await interaction.client.channels.fetch(channelId);
        
        if (!channel) {
          messageContent = '[Channel not found]';
        } else if (!channel.isTextBased()) {
          messageContent = '[Channel is not text-based]';
        } else {
          const permissions = channel.permissionsFor(interaction.client.user);
          if (!permissions.has(['ViewChannel', 'ReadMessageHistory'])) {
            messageContent = '[Bot lacks permissions to read this channel]';
          } else {
            const message = await channel.messages.fetch(messageId);
            messageContent = message.content || '[No text content]';
          }
        }
      }
    } else {
      messageContent = '[Invalid message link format]';
    }
  } catch (error) {
    console.error('Error fetching message:', error);
    messageContent = `[Could not fetch message: ${error.message}]`;
  }
}

  const header = new TextDisplayBuilder()
    .setContent("# User Report");

  const description = new TextDisplayBuilder()
    .setContent(
      `You reported a user. Review provided information:\n\n` +
      `**1. Reported User:** ${reportedUser.tag} (${reportedUser.id})\n` +
      `**2. Reason for the report:** ${reason}\n` +
      `**3. Message Link:** ${messageLink || 'Not provided'}\n` +
      `**4. Attachment Link:** ${attachmentLink || 'Not provided'}\n\n` +
      `This information will be sent to our safety team via Discord and will be reported to Discord Safety if it violates the policies.`
    );

  const confirmButton = new ButtonBuilder()
    .setCustomId('report_confirm')
    .setLabel('Confirm')
    .setStyle(ButtonStyle.Success);

  const cancelButton = new ButtonBuilder()
    .setCustomId('report_cancel')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Danger);

  const buttonRow = new ActionRowBuilder()
    .addComponents(confirmButton, cancelButton);

  const container = new ContainerBuilder()
    .setAccentColor(0xff0000)
    .addTextDisplayComponents(header, description)
    .addActionRowComponents(buttonRow);

  const response = await interaction.editReply({
    components: [container.toJSON()],
    flags: MessageFlags.IsComponentsV2
  });

  const collector = response.createMessageComponentCollector({ time: 60000 });

  collector.on('collect', async (i) => {
    if (i.customId === 'report_confirm') {
      const webhook = new WebhookClient({ url: process.env.REPORTS });
      
      const reportEmbed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('📋 User Report')
        .addFields(
          { name: 'Reported User', value: `${reportedUser.tag}\n(ID: ${reportedUser.id})`, inline: false },
          { name: 'Reason', value: reason, inline: false },
          { name: 'Message Link', value: messageLink ? `${messageLink}\n\`\`\`${messageContent || 'No content'}\`\`\`` : 'Not provided', inline: false },
          { name: 'Attachment Link', value: attachmentLink ? `||${attachmentLink}||` : 'Not provided', inline: false },
          { name: 'Reported by', value: `${i.user.tag}\n(ID: ${i.user.id})`, inline: false }
        )
        .setTimestamp();
      
      if (attachmentLink) {
        reportEmbed.setImage(`||${attachmentLink}||`);
      }

      if (webhook) {
        await webhook.send({
          embeds: [reportEmbed]
        });
      }

      const successText = new TextDisplayBuilder()
        .setContent("# ✅ Report Submitted\nYour report has been submitted successfully to our safety team.");

      const successContainer = new ContainerBuilder()
        .setAccentColor(0x00ff00)
        .addTextDisplayComponents(successText);

      await i.update({
        components: [successContainer.toJSON()],
        flags: MessageFlags.IsComponentsV2
      });
    } else if (i.customId === 'report_cancel') {
      const cancelText = new TextDisplayBuilder()
        .setContent("# ❌ Report Cancelled\nYour report has been cancelled.");

      const cancelContainer = new ContainerBuilder()
        .setAccentColor(0xff0000)
        .addTextDisplayComponents(cancelText);

      await i.update({
        components: [cancelContainer.toJSON()],
        flags: MessageFlags.IsComponentsV2
      });
    }
  });

  collector.on('end', async () => {
    try {
      await response.edit({ components: [] });
    } catch (error) {
    }
  });
}