const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const { emojis, DEVELOPER_IDS } = require('../../utils/config.js');


const COLORS = {
    SUCCESS: 0x2ECC71,
    ERROR: 0xE74C3C,
    WARN: 0xF1C40F,
    INFO: 0x3498DB,
    BAN: 0xAA0000,
    KICK: 0xE67E22,
    MUTE: 0xFFFFFF,
    UNBAN: 0x2ECC71,
    SOFTBAN: 0xE67E22,
    VOID: 0x546E7A,
    AUTOMOD: 0xAA0000,
    WHOIS: 0x3498DB
};

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('showcase')
        .setDescription('Visual gallery of ALL Bot Embeds (Developer Only).')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
        

        if (!DEVELOPER_IDS.includes(interaction.user.id)) {
            return interaction.editReply({ 
                content: `${emojis.error || '⛔'} **ACCESS DENIED.** This command is exclusively for Developers.`,
            });
        }

       
        const styleSuccess = new EmbedBuilder().setColor(COLORS.SUCCESS).setDescription(`${emojis.success || '✅'} This is a **Success** message.`);
        const styleError = new EmbedBuilder().setColor(COLORS.ERROR).setDescription(`${emojis.error || '❌'} This is an **Error** message.`);
        const styleWarn = new EmbedBuilder().setColor(COLORS.WARN).setDescription(`${emojis.warn || '⚠️'} This is a **Warning** message.`);
        const styleInfo = new EmbedBuilder().setColor(COLORS.INFO).setDescription(`${emojis.info || 'ℹ️'} This is an **Info** message.`);
        const styleModeration = new EmbedBuilder().setColor(COLORS.SUCCESS).setDescription(`**Action Completed**\nThis is the simple **Moderation** embed style used for public confirmations.`).setFooter({ text: 'Made by: ukirama' });

       
        const logBan = new EmbedBuilder().setColor(COLORS.BAN).setTitle('Ban').addFields({ name: 'User', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true }, { name: 'Staff', value: interaction.user.tag, inline: true }, { name: 'Reason', value: 'Violating Terms of Service', inline: false }, { name: 'Duration', value: 'Permanent', inline: true }).setFooter({ text: `Case ID: CASE-123456789` }).setTimestamp();
        const logKick = new EmbedBuilder().setColor(COLORS.KICK).setTitle('Kick').addFields({ name: 'User', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true }, { name: 'Staff', value: interaction.user.tag, inline: true }, { name: 'Reason', value: 'Repeated violations', inline: false }).setFooter({ text: `Case ID: CASE-KICK-123` }).setTimestamp();
        const logMute = new EmbedBuilder().setColor(COLORS.MUTE).setTitle('Mute').addFields({ name: 'User', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true }, { name: 'Staff', value: interaction.user.tag, inline: true }, { name: 'Reason', value: 'Spamming in chat', inline: false }, { name: 'Duration', value: '1h', inline: true }).setFooter({ text: `Case ID: CASE-MUTE-123` }).setTimestamp();
        const logWarn = new EmbedBuilder().setColor(COLORS.WARN).setTitle('Warn').addFields({ name: 'User', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true }, { name: 'Staff', value: interaction.user.tag, inline: true }, { name: 'Active Warnings', value: `3`, inline: true }, { name: 'Reason', value: 'Disrespectful behavior', inline: false }).setFooter({ text: `Case ID: CASE-WARN-123` }).setTimestamp();
        const logUnban = new EmbedBuilder().setColor(COLORS.UNBAN).setTitle('Unban').addFields({ name: 'User', value: `UserTag (${interaction.user.id})`, inline: true }, { name: 'Staff', value: interaction.user.tag, inline: true }, { name: 'Reason', value: 'Appeal Accepted', inline: false }).setFooter({ text: `Case ID: CASE-UNBAN-123` }).setTimestamp();
        const logUnmute = new EmbedBuilder().setColor(COLORS.UNBAN).setTitle('Unmute').addFields({ name: 'User', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true }, { name: 'Staff', value: interaction.user.tag, inline: true }, { name: 'Reason', value: 'Mistake corrected', inline: false }).setFooter({ text: `Case ID: CASE-UNMUTE-123` }).setTimestamp();
        const logSoftban = new EmbedBuilder().setColor(COLORS.SOFTBAN).setTitle('Softban').addFields({ name: 'User', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true }, { name: 'Staff', value: interaction.user.tag, inline: true }, { name: 'Messages Deleted', value: `1 hours`, inline: true }, { name: 'Reason', value: 'Spam cleanup', inline: false }).setFooter({ text: `Case ID: CASE-SB-123` }).setTimestamp();

        const publicBan = new EmbedBuilder().setColor(COLORS.SUCCESS).setDescription(`**${interaction.user.tag}** has been banned.\n**Reason:** Violating Terms of Service`).setFooter({ text: 'Made by: ukirama' });
        const publicKick = new EmbedBuilder().setColor(COLORS.SUCCESS).setDescription(`**${interaction.user.tag}** has been kicked.\n**Reason:** Inactive`).setFooter({ text: 'Made by: ukirama' });
        const publicMute = new EmbedBuilder().setColor(COLORS.SUCCESS).setDescription(`**${interaction.user.tag}** has been muted for **1h**.\n**Reason:** Spamming`).setFooter({ text: 'Made by: ukirama' });
        const publicLock = new EmbedBuilder().setColor(COLORS.SUCCESS).setDescription(`**CHANNEL LOCKED**\nThis channel has been placed under lockdown.\n**Reason:** Raid protection`).setFooter({ text: 'Made by: ukirama' });
        const publicUnlock = new EmbedBuilder().setColor(COLORS.SUCCESS).setDescription(`**CHANNEL UNLOCKED**\nLockdown lifted. Members may now send messages.\n**Reason:** Raid over`).setFooter({ text: 'Made by: ukirama' });
        const publicPurge = new EmbedBuilder().setColor(COLORS.SUCCESS).setDescription(`**Message Purge Complete**\nDeleted **50** message(s) in <#${interaction.channel.id}>.`).setFooter({ text: 'Made by: ukirama' });
        const publicSlowmode = new EmbedBuilder().setColor(COLORS.SUCCESS).setDescription(`**Slowmode Enabled**\nSet to **5s** (5 seconds).`).setFooter({ text: 'Made by: ukirama' });
        const publicBlacklist = new EmbedBuilder().setColor(COLORS.SUCCESS).setDescription(`**User Blacklisted**\n**${interaction.user.tag}** has been added to the appeal blacklist.`).setFooter({ text: 'Made by: ukirama' });

 
        const dmBan = new EmbedBuilder().setColor(COLORS.BAN).setTitle(`Banned from ${interaction.guild.name}`).setDescription(`You have been banned from **${interaction.guild.name}**.`).addFields({ name: 'Reason', value: 'Violating Terms of Service', inline: false }, { name: 'Duration', value: 'Permanent', inline: true }, { name: 'Appeal', value: '[Click here to appeal](https://discord.gg/example)', inline: true }).setFooter({ text: `Case ID: CASE-123` }).setTimestamp();
        const dmKick = new EmbedBuilder().setColor(COLORS.KICK).setTitle(`Kicked from ${interaction.guild.name}`).setDescription(`You have been kicked from **${interaction.guild.name}**.`).addFields({ name: 'Reason', value: 'Inactive for too long', inline: false }).setFooter({ text: `Case ID: CASE-KICK-123` }).setTimestamp();
        const dmMute = new EmbedBuilder().setColor(COLORS.MUTE).setTitle(`Muted in ${interaction.guild.name}`).setDescription(`You have been muted in **${interaction.guild.name}**.`).addFields({ name: 'Reason', value: 'Spamming in chat', inline: false }, { name: 'Duration', value: '1h', inline: true }).setFooter({ text: `Case ID: CASE-MUTE-123` }).setTimestamp();
        const dmWarn = new EmbedBuilder().setColor(COLORS.WARN).setTitle(`Warned in ${interaction.guild.name}`).setDescription(`You have been warned in **${interaction.guild.name}**.`).addFields({ name: 'Reason', value: 'Inappropriate Language', inline: false }).setFooter({ text: `Case ID: CASE-WARN-123` }).setTimestamp();
        const dmSoftban = new EmbedBuilder().setColor(COLORS.SOFTBAN).setTitle(`Softban Executed in ${interaction.guild.name}`).setDescription(`Your recent messages have been deleted, and you have been temporarily banned and immediately unbanned.`).addFields({ name: 'Reason', value: 'Spam cleanup', inline: false }).setFooter({ text: `Case ID: CASE-SB-123 | You are free to rejoin.` }).setTimestamp();

       
        const caseDetails = new EmbedBuilder().setColor(COLORS.BAN).setTitle(`Case CASE-12345`).addFields({ name: 'User', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true }, { name: 'Staff', value: interaction.user.tag, inline: true }, { name: 'Action', value: 'BAN', inline: true }, { name: 'Reason', value: 'Hate speech', inline: false }, { name: 'Duration', value: 'Permanent', inline: true }, { name: 'Status', value: 'ACTIVE', inline: true }).setFooter({ text: `Date: ${new Date().toLocaleString()}` });
        const caseVoid = new EmbedBuilder().setColor(COLORS.VOID).setTitle(`${emojis.void || '🗑️'} Case Annulled (VOIDED)`).setDescription(`The moderation log for **Case ID \`CASE-12345\`** has been successfully annulled.`).addFields({ name: `${emojis.user || '👤'} User`, value: `<@${interaction.user.id}>`, inline: true }, { name: `${emojis.ban || '🔨'} Original Action`, value: 'BAN', inline: true }, { name: `${emojis.moderator || '👮'} Moderator`, value: interaction.user.tag, inline: true }, { name: `${emojis.reason || '📝'} Void Reason`, value: `Mistaken Identity`, inline: false }).setFooter({ text: `This case will now appear as voided.` }).setTimestamp();
        const whoisEmbed = new EmbedBuilder().setColor(COLORS.WHOIS).setAuthor({ name: `Whois: ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() }).setThumbnail(interaction.user.displayAvatarURL()).addFields({ name: 'User ID', value: `\`${interaction.user.id}\``, inline: true }, { name: 'Created At', value: `<t:${Math.floor(interaction.user.createdTimestamp / 1000)}:R>`, inline: true }, { name: 'Joined At', value: `<t:${Math.floor(interaction.member.joinedTimestamp / 1000)}:R>`, inline: true }, { name: 'Roles [2]', value: `<@&${interaction.guild.roles.everyone.id}>`, inline: false }).setFooter({ text: `Requested by ${interaction.user.tag}` });

 
        const setupPanel = new EmbedBuilder().setColor(0x0099FF).setTitle(`⚙️ ${interaction.guild.name}'s Setup Panel`).setDescription(`Configure the bot using the buttons below.`).addFields({ name: `${emojis.channel || '📺'} Log Channels`, value: `**Mod Log:** <#${interaction.channel.id}>\n**Anti-Nuke:** <#${interaction.channel.id}>` }, { name: `${emojis.role || '🛡️'} Roles`, value: `**Staff Roles:** @Moderator, @Admin` }, { name: `${emojis.lock || '🔒'} Permissions`, value: `\`/ban\`: @Admin` }, { name: '☢️ Anti-Nuke', value: `✅ **ENABLED**` });
        const antiNukeAlert = new EmbedBuilder().setTitle(`${emojis.warn || '⚠️'} SERVER NUKE ATTEMPT BLOCKED`).setDescription(`**User:** RogueAdmin#0000\n**Action:** Mass CHANNEL_DELETE\n**Result:** ${emojis.ban || '🔨'} Banned & Restoring...`).setColor(COLORS.ERROR).setTimestamp();
        const ticketPanel = new EmbedBuilder().setTitle('🎫 Support Tickets').setDescription('Need help? Click the button below to open a ticket.').setColor(COLORS.SUCCESS).setFooter({ text: 'Support Team' });

        const selectMenu = new StringSelectMenuBuilder().setCustomId('showcase_select').setPlaceholder('Select a category to preview...').addOptions([{ label: 'Standard Styles', description: 'Success, Error, Warn, Info.', value: 'styles', emoji: '🎨' }, { label: 'Moderation Logs', description: 'Minimalist logs (Red Ban, Orange Kick...).', value: 'modlogs', emoji: '📜' }, { label: 'Public Confirmations', description: 'Simple Green embeds for public chat.', value: 'public', emoji: '📢' }, { label: 'User DMs', description: 'Simple & Direct punishment notifications.', value: 'dms', emoji: '📩' }, { label: 'Special Commands', description: 'Case (Simple), Void (Detailed), Whois (Simple).', value: 'special', emoji: '⭐' }, { label: 'System & Utility', description: 'Setup, AntiNuke, Tickets.', value: 'system', emoji: '⚙️' },]);
        const row = new ActionRowBuilder().addComponents(selectMenu);

        const msg = await interaction.editReply({ content: '🎨 **Ultimate Embed Showcase**\nSelect a category below to inspect ALL the bot\'s visual designs.', components: [row], embeds: [] });
        const collector = msg.createMessageComponentCollector({ time: 300000 }); 

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) return i.reply({ content: 'Not your command.', flags: [MessageFlags.Ephemeral] });
            await i.deferUpdate(); 
            const value = i.values[0];
            let embedsToSend = [];
            let contentText = '';

            switch (value) {
                case 'styles': contentText = '**Category: Standard Styles**'; embedsToSend = [styleSuccess, styleError, styleWarn, styleInfo, styleModeration]; break;
                case 'modlogs': contentText = '**Category: Moderation Logs (Minimalist Style)**'; embedsToSend = [logBan, logKick, logMute, logWarn, logUnban, logUnmute, logSoftban]; break;
                case 'public': contentText = '**Category: Public Confirmations (Simple Green)**'; embedsToSend = [publicBan, publicKick, publicMute, publicLock, publicUnlock, publicPurge, publicSlowmode, publicBlacklist]; break;
                case 'dms': contentText = '**Category: User DMs (Simple & Direct)**'; embedsToSend = [dmBan, dmKick, dmMute, dmWarn, dmSoftban]; break;
                case 'special': contentText = '**Category: Special Commands**'; embedsToSend = [caseDetails, caseVoid, whoisEmbed]; break;
                case 'system': contentText = '**Category: System & Utility**'; embedsToSend = [setupPanel, antiNukeAlert, ticketPanel]; break;
            }
            await i.editReply({ content: contentText, embeds: embedsToSend, components: [row] });
        });
    }
};