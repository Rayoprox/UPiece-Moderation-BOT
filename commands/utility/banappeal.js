const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ChannelType, PermissionsBitField, MessageFlags } = require('discord.js');
const { emojis } = require('../../utils/config.js');

module.exports = {
    deploy: 'appeal',
    data: new SlashCommandBuilder()
        .setName('banappeals')
        .setDescription('Posts the ban appeal information embed.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('The channel to post the appeal embed in.')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)),

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel');
        const mainGuildName = interaction.client.guilds.cache.get(process.env.DISCORD_GUILD_ID)?.name;
        const serverName = mainGuildName || interaction.guild?.name || 'this server';

        const appealEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`${emojis.ban} ${serverName} Ban Appeal System`)
            .setDescription(
                `Welcome to the official appeal process. If you have received a **permanent ban** from **${serverName}**, this is your opportunity to request a review from our moderation team.\n\nPlease read all sections below very carefully before proceeding.`
            )
            .addFields(
                { 
                    name: `${emojis.info} Eligibility Requirements`, 
                    value: 
                        `• **Only permanent bans are appealable.** Temporary bans will expire automatically and cannot be appealed through this system.\n` +
                        `• You must have the **Case ID** provided in the DM you received upon being banned. Appeals without a valid Case ID will be ignored.\n` +
                        `• Bans for severe violations (e.g., related to Discord's ToS) may be marked as non-appealable.`
                },
                {
                    name: `${emojis.reason} How to Write a Successful Appeal`,
                    value:
                        `To increase your chances of a successful appeal, we recommend including the following:\n` +
                        `• **Honesty and Accountability:** Acknowledge the rule(s) you broke and take responsibility for your actions.\n` +
                        `• **Understanding:** Show that you have re-read our server rules and now understand why your actions were inappropriate.\n` +
                        `• **Future Conduct:** Briefly explain why you wish to rejoin our community and how you will contribute positively in the future.`
                },
                { 
                    name: `${emojis.rules} The Process`, 
                    value: 
                        `1. Click the "Start Ban Appeal" button below.\n` +
                        `2. The bot will verify your status. If eligible, a button to open the form will appear.\n` +
                        `3. Fill out the form completely.\n` +
                        `4. After submission, your case is added to a private queue for the moderation team to review.`
                },
                { 
                    name: `${emojis.warn} Important Rules & Common Mistakes`, 
                    value: 
                        `• **Do not contact staff members** via DM to ask about your appeal's status. This will result in your appeal being rejected.\n` +
                        `• **Do not use alternate accounts** to evade your ban or contact staff. This will result in a permanent ban on all associated accounts.\n` +
                        `• **Do not ask friends to appeal on your behalf.** You must submit your own appeal.\n` +
                        `• All decisions made by the moderation team are **final**.`
                }
            )
            .setFooter({ text: 'Please be patient. The review process can take several days.' });
            
        const appealButton = new ButtonBuilder()
            .setCustomId('start_appeal_process')
            .setLabel('Start Ban Appeal')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📝');
            
        const row = new ActionRowBuilder().addComponents(appealButton);

        try {
            await channel.send({ embeds: [appealEmbed], components: [row] });
            await interaction.editReply({ content: `${emojis.success} The appeal embed has been successfully sent to ${channel}.`, flags: [MessageFlags.Ephemeral] });
        } catch (error) {
            console.error('Failed to send appeal embed:', error);
            await interaction.editReply({ content: `${emojis.error} I do not have permission to send messages in that channel.`, flags: [MessageFlags.Ephemeral] });
        }
    },
};
