const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');
const { emojis } = require('../../utils/config.js');
const { success, error, moderation } = require('../../utils/embedFactory.js');

const KICK_COLOR = 0xE67E22; 

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kicks a member from the server.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addUserOption(option => option.setName('user').setDescription('The user to kick.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the kick.').setRequired(false)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason specified';
        const moderatorMember = interaction.member;
        const guildId = interaction.guild.id;

        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
   
        if (!targetMember) return interaction.editReply({ embeds: [error('User is not in the server.')] });
        if (targetUser.id === interaction.user.id) return interaction.editReply({ embeds: [error('You cannot kick yourself.')] });
        if (targetUser.id === interaction.client.user.id) return interaction.editReply({ embeds: [error('You cannot kick me.')] });
        if (targetUser.id === interaction.guild.ownerId) return interaction.editReply({ embeds: [error('You cannot kick the server owner.')] });
        
        let staffIds = [];
        
        // Intenta SELECT staff_roles; si no existe, usa fallback
        try {
            const guildSettingsResult = await db.query('SELECT staff_roles FROM guild_settings WHERE guildid = $1', [guildId]);
            const guildSettings = guildSettingsResult.rows[0];
            staffIds = guildSettings?.staff_roles ? guildSettings.staff_roles.split(',') : [];
        } catch (e) {
            if (e.message?.includes('staff_roles')) {
                console.log('ℹ️  [kick.js] Columna staff_roles no existe aún en BD');
                staffIds = [];
            } else {
                throw e;
            }
        }
        
        if (targetMember.roles.cache.some(r => staffIds.includes(r.id))) return interaction.editReply({ embeds: [error('You cannot moderate a staff member.')] });
        if (moderatorMember.roles.highest.position <= targetMember.roles.highest.position) return interaction.editReply({ embeds: [error('You cannot kick a user with a role equal to or higher than your own.')] });
        if (!targetMember.kickable) return interaction.editReply({ embeds: [error('I do not have permission to kick this user (their role is likely higher than mine).')] });

        const caseId = `CASE-${Date.now()}`;
        const moderatorTag = interaction.user.tag;
        const cleanModeratorTag = moderatorTag.trim();
        const cleanReason = reason.trim();
        const currentTimestamp = Date.now();
        let dmSent = false;
        
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor(KICK_COLOR) 
                .setTitle(`Kicked from ${interaction.guild.name}`)
                .setDescription(`You have been kicked from **${interaction.guild.name}**.`)
                .addFields(
                    { name: 'Reason', value: cleanReason, inline: false }
                )
                .setFooter({ text: `Case ID: ${caseId}` })
                .setTimestamp();
            
            
            await targetUser.send({ embeds: [dmEmbed] });
            dmSent = true;
        } catch (error) {
            dmSent = false;
        }

        try {
            const kickReason = `[CMD] ${cleanReason} (Moderator: ${cleanModeratorTag}, Case ID: ${caseId})`;
            await targetMember.kick(kickReason);

            await db.query(`
                INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, appealable, status, dmstatus)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `, [caseId, guildId, 'KICK', targetUser.id, targetUser.tag, interaction.user.id, cleanModeratorTag, cleanReason, currentTimestamp, 0, 'EXECUTED', dmSent ? 'SENT' : 'FAILED']);

            const modLogResult = await db.query('SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2', [guildId, 'modlog']);
            const modLogChannelId = modLogResult.rows[0]?.channel_id;
            
            if (modLogChannelId) {
                const channel = interaction.guild.channels.cache.get(modLogChannelId);
                if (channel) {
                   const modLogEmbed = new EmbedBuilder()
                    .setColor(KICK_COLOR)
                    .setTitle('Kick')
                    .addFields(
                        { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                        { name: 'Staff', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                        { name: 'Reason', value: cleanReason, inline: false }
                    )
                    .setFooter({ text: `Case ID: ${caseId}` })
                    .setTimestamp();
                    
                    const sentMessage = await channel.send({ embeds: [modLogEmbed] }).catch(console.error);
                    if (sentMessage) await db.query('UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2', [sentMessage.id, caseId]);
                }
            }
            
            const publicEmbed = moderation(`**${targetUser.tag}** has been kicked.\n**Reason:** ${cleanReason}`);
            await interaction.editReply({ embeds: [publicEmbed] });

        } catch (err) {
            console.error('[ERROR] Failed to execute kick:', err);
            return interaction.editReply({ embeds: [error('An error occurred during the kick execution.')] });
        }
    },
};
