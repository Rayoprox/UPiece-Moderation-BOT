const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');
const ms = require('ms');
const { resumePunishmentsOnStart } = require('../../utils/temporary_punishment_handler.js');
const { emojis } = require('../../utils/config.js');
const { success, error } = require('../../utils/embedFactory.js');

const MUTE_COLOR = 0xFFA500; 

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Mutes a member for a specified duration (uses Timeout).')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to mute.').setRequired(true))
        .addStringOption(option => option.setName('duration').setDescription('Duration of the mute (e.g., 10m, 1h, 2d). Max: 28 days.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the mute.').setRequired(false)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const durationStr = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason') || 'No reason specified';
        const moderatorMember = interaction.member;
        const guildId = interaction.guild.id;

        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      
        if (!targetMember) return interaction.editReply({ embeds: [error('User is not in the server.')] });
        if (targetUser.id === interaction.user.id) return interaction.editReply({ embeds: [error('You cannot mute yourself.')] });
        if (targetUser.id === interaction.client.user.id) return interaction.editReply({ embeds: [error('You cannot mute me.')] });
        if (targetUser.id === interaction.guild.ownerId) return interaction.editReply({ embeds: [error('You cannot mute the server owner.')] });
        if (targetMember.isCommunicationDisabled()) return interaction.editReply({ embeds: [error('This user is already muted.')] });
        
        const guildSettingsResult = await db.query('SELECT staff_roles FROM guild_settings WHERE guildid = $1', [guildId]);
        const guildSettings = guildSettingsResult.rows[0];
        
        const staffIds = guildSettings?.staff_roles ? guildSettings.staff_roles.split(',') : [];
        if (targetMember.roles.cache.some(r => staffIds.includes(r.id))) return interaction.editReply({ embeds: [error('You cannot moderate a staff member.')] });
        if (moderatorMember.roles.highest.position <= targetMember.roles.highest.position) return interaction.editReply({ embeds: [error('You cannot mute a user with a role equal to or higher than your own.')] });
        
        let durationMs;
        try { durationMs = ms(durationStr); } catch (e) { return interaction.editReply({ embeds: [error('Invalid duration format. Use formats like "10m", "1h".')] }); }

        if (!durationMs || durationMs < 5000 || durationMs > 2419200000) return interaction.editReply({ embeds: [error('Duration must be between 5 seconds and 28 days.')] });

        const endsAt = Date.now() + durationMs;
        const caseId = `CASE-${Date.now()}`;
        const moderatorTag = interaction.user.tag;
        const cleanModeratorTag = moderatorTag.trim();
        const cleanReason = reason.trim();
        const currentTimestamp = Date.now();

        let dmSent = false;
        try {
             const dmEmbed = new EmbedBuilder()
                .setColor(MUTE_COLOR)
                .setTitle(`${emojis.mute} You've Been Timed Out in ${interaction.guild.name}`)
                .setDescription(`Your communication privileges have been restricted.`)
                .setThumbnail(interaction.guild.iconURL({ dynamic: true, size: 128 }))
                .addFields(
                    { name: `${emojis.duration} Duration`, value: durationStr, inline: true },
                    { name: `${emojis.moderator} Moderator`, value: cleanModeratorTag, inline: true },
                    { name: `${emojis.reason} Reason`, value: `\`\`\`\n${cleanReason}\n\`\`\``, inline: false }
                )
                .setFooter({ text: `Case ID: ${caseId} | Time ends:` })
                .setTimestamp(endsAt);
            await targetUser.send({ embeds: [dmEmbed] });
            dmSent = true;
        } catch (error) { dmSent = false; }

        try {
            await targetMember.timeout(durationMs, `[CMD] ${cleanReason} (Moderator: ${cleanModeratorTag})`);
        } catch (err) {
            console.error('[ERROR] Failed to execute timeout:', err);
            return interaction.editReply({ embeds: [error('An error occurred. Please check my permissions.')] });
        }

        await db.query(`
            INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, endsAt, action_duration, status, dmstatus)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [
            caseId, guildId, 'TIMEOUT', targetUser.id, targetUser.tag, 
            interaction.user.id, cleanModeratorTag, cleanReason, currentTimestamp, endsAt, durationStr, 'ACTIVE', dmSent ? 'SENT' : 'FAILED'
        ]);

        resumePunishmentsOnStart(interaction.client); 

     
        const modLogResult = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2", [guildId, 'modlog']);
        if (modLogResult.rows[0]?.channel_id) {
            const channel = interaction.guild.channels.cache.get(modLogResult.rows[0].channel_id);
            if(channel) {
                const modLogEmbed = new EmbedBuilder()
                    .setColor(MUTE_COLOR)
                    .setAuthor({ name: `${targetUser.tag} has been MUTED`, iconURL: targetUser.displayAvatarURL({ dynamic: true }) })
                    .addFields(
                        { name: `${emojis.user} User`, value: `<@${targetUser.id}> (\`${targetUser.id}\`)`, inline: true }, 
                        { name: `${emojis.moderator} Moderator`, value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
                        { name: `${emojis.duration} Duration`, value: durationStr, inline: true }, 
                        { name: `${emojis.reason} Reason`, value: cleanReason, inline: false }, 
                        { name: `${emojis.dm_sent} DM Sent`, value: dmSent ? '✅ Yes' : '❌ No/Failed', inline: true }
                    )
                    .setFooter({ text: `Case ID: ${caseId}` })
                    .setTimestamp();
                const sentMessage = await channel.send({ embeds: [modLogEmbed] }).catch(console.error);
                if (sentMessage) await db.query("UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2", [sentMessage.id, caseId]);
            }
        }
        
      
        const publicEmbed = success(`**${targetUser.tag}** has been **timed out** successfully.`)
            .setTitle(`${emojis.success} Mute Applied`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 64 }))
            .addFields(
                { name: `${emojis.moderator} Moderator`, value: `<@${interaction.user.id}>`, inline: true }, 
                { name: `${emojis.duration} Duration`, value: durationStr, inline: true }, 
                { name: `${emojis.case_id} Case ID`, value: `\`${caseId}\``, inline: true },
                { name: `${emojis.reason} Reason`, value: cleanReason, inline: false }
            )
            .setFooter({ text: `Timeout ends:` })
            .setTimestamp(endsAt); 
            
        await interaction.editReply({ embeds: [publicEmbed] });
    },
};