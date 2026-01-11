const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const { emojis } = require('../../utils/config.js');


const DEVELOPER_ID = '715926664344895559';

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('showcase')
        .setDescription('🎨 Visual gallery of all Bot Embeds (Developer Only).')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
        // Dev
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
                { name: `${emojis.channel} Log Channels`, value: `**Mod Log:** <#${interaction.channel.id}>\n**Anti-Nuke:** <#${interaction.channel.id}>` },
                { name: `${emojis.role} Roles`, value: `**Staff Roles:** @Moderator, @Admin` },
                { name: `${emojis.lock} Permissions`, value: `\`/ban\`: @Admin` },
                { name: `${emojis.rules} Automod Rules`, value: `**#1**: 3 warns -> **MUTE** (1h)` },
                { name: '☢️ Anti-Nuke', value: `✅ **ENABLED**` }
            );

        const universalEmbed = new EmbedBuilder()
            .setTitle('👑 Management Control Panel')
            .setDescription(`Control the absolute permission state of the bot.\n\n**Current State:** ${emojis.lock} **RESTRICTED (Lockdown)**`)
            .addFields(
                { name: `${emojis.unlock} Default YES`, value: 'Admins have full access. `/setup` works normally.' },
                { name: `${emojis.lock} Default NO`, value: 'Strict Mode. Admins have **NO** access unless explicitly whitelisted.' }
            )
            .setColor(0xFF0000);

      
        const warnLogEmbed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setAuthor({ name: `UserTag has been WARNED`, iconURL: interaction.user.displayAvatarURL() })
            .addFields(
                { name: `${emojis.user} User`, value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
                { name: `${emojis.moderator} Moderator`, value: `<@${interaction.client.user.id}>`, inline: true },
                { name: `${emojis.warn} Active Warnings`, value: `3`, inline: true },
                { name: `${emojis.reason} Reason`, value: `Posting invite links in general chat.`, inline: false },
                { name: `${emojis.dm_sent} DM Sent`, value: '✅ Yes', inline: true }
            )
            .setFooter({ text: `Case ID: CASE-123456789` })
            .setTimestamp();

        const banLogEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setAuthor({ name: `UserTag has been BANNED`, iconURL: interaction.user.displayAvatarURL() })
            .addFields(
                { name: `${emojis.user} User`, value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
                { name: `${emojis.moderator} Moderator`, value: `<@${interaction.client.user.id}>`, inline: true },
                { name: `${emojis.duration} Duration`, value: `Permanent`, inline: true },
                { name: `${emojis.reason} Reason`, value: `Mass spamming and raiding behavior.`, inline: false },
            )
            .setFooter({ text: `Case ID: CASE-987654321` })
            .setTimestamp();

    
        const dmWarnEmbed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle(`${emojis.warn} Official Warning Issued in ${interaction.guild.name}`)
            .setDescription(`This is an official warning regarding your recent conduct.`)
            .addFields(
                { name: `${emojis.moderator} Moderator`, value: `Staff Team` },
                { name: `${emojis.reason} Reason`, value: `\`\`\`Please stop spamming emojis.\`\`\`` }
            )
            .setFooter({ text: `Case ID: CASE-123456789` })
            .setTimestamp();

        const dmBanEmbed = new EmbedBuilder()
            .setColor(0xAA0000)
            .setTitle(`${emojis.ban} You have been Banned from ${interaction.guild.name}`)
            .setDescription(`You have been removed from the server.`)
            .setThumbnail(interaction.guild.iconURL())
            .addFields(
                { name: `${emojis.moderator} Moderator`, value: `Staff Team`, inline: true },
                { name: `${emojis.duration} Duration`, value: `Permanent`, inline: true },
                { name: `${emojis.reason} Reason`, value: `\`\`\`Violating Terms of Service.\`\`\``, inline: false }
            )
            .setFooter({ text: `Case ID: CASE-987654321` });

      
        const antiNukeEmbed = new EmbedBuilder()
            .setTitle(`${emojis.warn} SERVER NUKE ATTEMPT BLOCKED`)
            .setDescription(`**User:** RogueAdmin#0000\n**Action:** Mass CHANNEL_DELETE\n**Result:** ${emojis.ban} Banned & Restoring...`)
            .setColor(0xFF0000)
            .setTimestamp();

        const unverifiedBotEmbed = new EmbedBuilder()
            .setTitle(`${emojis.warn} UNVERIFIED BOT BANNED`)
            .setDescription(`**Bot:** RandomBot#1234 (\`888888888888888888\`)\n**Invited By:** User#0000 (\`111111111111111111\`)\n**Reason:** Not Verified & Not Whitelisted`)
            .setColor(0xFFA500)
            .setTimestamp();

      

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('showcase_select')
            .setPlaceholder('Select a category to preview...')
            .addOptions([
                { label: 'System & Panels', description: 'Setup, Universal Panel, Status.', value: 'system', emoji: '⚙️' },
                { label: 'Moderation Logs', description: 'Embeds sent to log channels.', value: 'modlogs', emoji: '🛡️' },
                { label: 'User DMs', description: 'What the punished user sees.', value: 'dms', emoji: '📩' },
                { label: 'Anti-Nuke Alerts', description: 'Security system triggers.', value: 'antinuke', emoji: '☢️' },
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);

    
        const msg = await interaction.editReply({ 
            content: '🎨 **Embed Showcase Gallery**\nSelect a category below to preview the bot\'s designs.', 
            components: [row] 
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
                case 'antinuke':
                    contentText = '**Category: Anti-Nuke Security**';
                    embedsToSend = [antiNukeEmbed, unverifiedBotEmbed];
                    break;
            }

            await i.editReply({ content: contentText, embeds: embedsToSend, components: [row] });
        });
    }
};