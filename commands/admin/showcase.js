const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, MessageFlags } = require('discord.js');
const { emojis } = require('../../utils/config.js');

const DEVELOPER_ID = '715926664344895559';

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('showcase')
        .setDescription('🎨 Visual gallery of ALL Bot Embeds (Developer Only).')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
       
        if (interaction.user.id !== DEVELOPER_ID) {
            return interaction.editReply({ 
                content: `${emojis.error || '⛔'} **ACCESS DENIED.** This command is exclusively for the Developer.`,
            });
        }

        
        const setupEmbed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle(`⚙️ ${interaction.guild.name}'s Setup Panel`)
            .setDescription(`Configure the bot using the buttons below.`)
            .addFields(
                { name: `${emojis.channel || '📺'} Log Channels`, value: `**Mod Log:** <#${interaction.channel.id}>\n**Anti-Nuke:** <#${interaction.channel.id}>` },
                { name: `${emojis.role || '🛡️'} Roles`, value: `**Staff Roles:** @Moderator, @Admin` },
                { name: `${emojis.lock || '🔒'} Permissions`, value: `\`/ban\`: @Admin` },
                { name: '☢️ Anti-Nuke', value: `✅ **ENABLED**` }
            );

        const universalEmbed = new EmbedBuilder()
            .setTitle('👑 Management Control Panel')
            .setDescription(`Control the absolute permission state of the bot.\n\n**Current State:** ${emojis.lock || '🔒'} **RESTRICTED (Lockdown)**`)
            .addFields(
                { name: `${emojis.unlock || '🔓'} Default YES`, value: 'Admins have full access. `/setup` works normally.' },
                { name: `${emojis.lock || '🔒'} Default NO`, value: 'Strict Mode. Admins have **NO** access unless explicitly whitelisted.' }
            )
            .setColor(0xFF0000);

      
        const warnLogEmbed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setAuthor({ name: `UserTag has been WARNED`, iconURL: interaction.user.displayAvatarURL() })
            .addFields(
                { name: `${emojis.user || '👤'} User`, value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
                { name: `${emojis.moderator || '👮'} Moderator`, value: `<@${interaction.client.user.id}>`, inline: true },
                { name: `${emojis.warn || '⚠️'} Active Warnings`, value: `3`, inline: true },
                { name: `${emojis.reason || '📝'} Reason`, value: `Posting invite links in general chat.`, inline: false },
                { name: `${emojis.dm_sent || '📩'} DM Sent`, value: '✅ Yes', inline: true }
            )
            .setFooter({ text: `Case ID: CASE-123456789` })
            .setTimestamp();

        const banLogEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setAuthor({ name: `UserTag has been BANNED`, iconURL: interaction.user.displayAvatarURL() })
            .addFields(
                { name: `${emojis.user || '👤'} User`, value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
                { name: `${emojis.moderator || '👮'} Moderator`, value: `<@${interaction.client.user.id}>`, inline: true },
                { name: `${emojis.duration || '⏰'} Duration`, value: `Permanent`, inline: true },
                { name: `${emojis.reason || '📝'} Reason`, value: `Mass spamming and raiding behavior.`, inline: false },
            )
            .setFooter({ text: `Case ID: CASE-987654321` })
            .setTimestamp();

        const dmWarnEmbed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle(`${emojis.warn || '⚠️'} Official Warning Issued in ${interaction.guild.name}`)
            .setDescription(`This is an official warning regarding your recent conduct.`)
            .addFields(
                { name: `${emojis.moderator || '👮'} Moderator`, value: `Staff Team` },
                { name: `${emojis.reason || '📝'} Reason`, value: `\`\`\`Please stop spamming emojis.\`\`\`` }
            )
            .setFooter({ text: `Case ID: CASE-123456789` })
            .setTimestamp();

        const dmBanEmbed = new EmbedBuilder()
            .setColor(0xAA0000)
            .setTitle(`${emojis.ban || '🔨'} You have been Banned from ${interaction.guild.name}`)
            .setDescription(`You have been removed from the server.`)
            .setThumbnail(interaction.guild.iconURL())
            .addFields(
                { name: `${emojis.moderator || '👮'} Moderator`, value: `Staff Team`, inline: true },
                { name: `${emojis.duration || '⏰'} Duration`, value: `Permanent`, inline: true },
                { name: `${emojis.reason || '📝'} Reason`, value: `\`\`\`Violating Terms of Service.\`\`\``, inline: false }
            )
            .setFooter({ text: `Case ID: CASE-987654321` });

     
        const ticketPanelEmbed = new EmbedBuilder()
            .setTitle('🎫 Support Tickets')
            .setDescription('Need help? Click the button below to open a ticket.')
            .setColor(0x2ECC71)
            .setFooter({ text: 'Support Team' });

        const ticketOpenEmbed = new EmbedBuilder()
            .setTitle('🎫 Ticket #0001')
            .setDescription('Thank you for contacting support.\nPlease describe your issue and wait for a staff member.')
            .setColor(0x2ECC71)
            .addFields(
                { name: '👤 User', value: `<@${interaction.user.id}>`, inline: true },
                { name: '🔒 Status', value: 'Open', inline: true }
            );


        const pingEmbed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('🟢 System Status: Excellent')
            .setDescription('**Universal Piece** is currently operational.')
            .addFields(
                { name: '📡 API Latency', value: `\`\`\`yml\n23ms\`\`\``, inline: true },
                { name: '🗄️ Database', value: `\`\`\`yml\n12ms\`\`\``, inline: true },
                { name: '⏱️ Uptime', value: `\`2d 4h 12m\``, inline: true }
            );

        const appealEmbed = new EmbedBuilder()
            .setTitle('📝 Ban Appeal Request')
            .setDescription('To appeal your ban, please fill out the form below carefully.')
            .setColor(0xF1C40F)
            .addFields({ name: '⚠️ Note', value: 'Lying will result in a permanent blacklist.' });

        const antiNukeEmbed = new EmbedBuilder()
            .setTitle(`${emojis.warn || '⚠️'} SERVER NUKE ATTEMPT BLOCKED`)
            .setDescription(`**User:** RogueAdmin#0000\n**Action:** Mass CHANNEL_DELETE\n**Result:** ${emojis.ban || '🔨'} Banned & Restoring...`)
            .setColor(0xFF0000)
            .setTimestamp();

    
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('showcase_select')
            .setPlaceholder('Select a category to preview...')
            .addOptions([
                { label: 'System & Panels', description: 'Setup, Universal Panel.', value: 'system', emoji: '⚙️' },
                { label: 'Moderation Logs', description: 'Embeds sent to log channels.', value: 'modlogs', emoji: '🛡️' },
                { label: 'User DMs', description: 'What the punished user sees.', value: 'dms', emoji: '📩' },
                { label: 'Ticket System', description: 'Ticket creation and management embeds.', value: 'tickets', emoji: '🎫' },
                { label: 'Utility & Appeals', description: 'Ping, Help, Appeals.', value: 'utility', emoji: '🛠️' },
                { label: 'Anti-Nuke Alerts', description: 'Security system triggers.', value: 'antinuke', emoji: '☢️' },
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const msg = await interaction.editReply({ 
            content: '🎨 **Ultimate Embed Showcase**\nSelect a category below to inspect the bot\'s visual design.', 
            components: [row],
            embeds: []
        });

        const collector = msg.createMessageComponentCollector({ time: 300000 }); 

        collector.on('collect', async i => {
            if (i.user.id !== interaction.user.id) return i.reply({ content: 'Not your command.', flags: [MessageFlags.Ephemeral] });
            
            await i.deferUpdate(); 
            const value = i.values[0];

            let embedsToSend = [];
            let contentText = '';

            switch (value) {
                case 'system':
                    contentText = '**Category: System & Panels**';
                    embedsToSend = [setupEmbed, universalEmbed];
                    break;
                case 'modlogs':
                    contentText = '**Category: Moderation Logs (Admin View)**';
                    embedsToSend = [warnLogEmbed, banLogEmbed];
                    break;
                case 'dms':
                    contentText = '**Category: Direct Messages (User View)**';
                    embedsToSend = [dmWarnEmbed, dmBanEmbed];
                    break;
                case 'tickets':
                    contentText = '**Category: Ticket System**';
                    embedsToSend = [ticketPanelEmbed, ticketOpenEmbed];
                    break;
                case 'utility':
                    contentText = '**Category: Utility & Appeals**';
                    embedsToSend = [pingEmbed, appealEmbed];
                    break;
                case 'antinuke':
                    contentText = '**Category: Anti-Nuke Security**';
                    embedsToSend = [antiNukeEmbed];
                    break;
            }

            await i.editReply({ content: contentText, embeds: embedsToSend, components: [row] });
        });
    }
};