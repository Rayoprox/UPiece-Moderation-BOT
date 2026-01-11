const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');
const ms = require('ms');
const { emojis } = require('../../utils/config.js'); 
const { resumePunishmentsOnStart } = require('../../utils/temporary_punishment_handler.js');
const { success, error } = require('../../utils/embedFactory.js');

const APPEAL_SERVER_INVITE = process.env.DISCORD_APPEAL_INVITE_LINK;
const BAN_COLOR = 0xAA0000;

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Bans a member from the server.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers) 
        .addUserOption(option => option.setName('user').setDescription('The user to ban (mention or ID).').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the ban.'))
        .addStringOption(option => option.setName('duration').setDescription('Duration of the ban (e.g., 7d, 2h, 30m). Permanent if omitted.'))
        .addStringOption(option => option.setName('delete_messages').setDescription('Delete messages from the banned user.').addChoices(
            { name: 'Don\'t delete', value: '0' }, { name: 'Last hour', value: '3600' },
            { name: 'Last 24 hours', value: '86400' }, { name: 'Last 7 days', value: '604800' }
        ))
        .addBooleanOption(option => option.setName('blacklist').setDescription('Immediately blacklist the user from appealing this ban (default: No).')),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason specified';
        const timeStr = interaction.options.getString('duration');
        const deleteMessageSeconds = parseInt(interaction.options.getString('delete_messages') || '0', 10);
        const shouldBlacklist = interaction.options.getBoolean('blacklist') ?? false;
        let isAppealable = !shouldBlacklist; 
        const moderatorMember = interaction.member;
        const guildId = interaction.guild.id;
        const moderatorTag = interaction.user.tag;
        
        const cleanModeratorTag = moderatorTag.trim();
        const cleanReason = reason.trim();
        const currentTimestamp = Date.now();
        
        if (targetUser.id === interaction.user.id) return interaction.editReply({ embeds: [error('You cannot ban yourself.')] });
        if (targetUser.id === interaction.client.user.id) return interaction.editReply({ embeds: [error('You cannot ban me.')] });
        if (targetUser.id === interaction.guild.ownerId) return interaction.editReply({ embeds: [error('You cannot ban the server owner.')] });

        const isBanned = await interaction.guild.bans.fetch(targetUser.id).catch(() => null);
        if (isBanned) return interaction.editReply({ embeds: [error('This user is already banned.')] });

        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (targetMember) {
            const guildSettingsResult = await db.query('SELECT staff_roles FROM guild_settings WHERE guildid = $1', [guildId]);
            const guildSettings = guildSettingsResult.rows[0];
            const staffIds = guildSettings?.staff_roles ? guildSettings.staff_roles.split(',') : [];
            if (targetMember.roles.cache.some(r => staffIds.includes(r.id))) return interaction.editReply({ embeds: [error('You cannot moderate a staff member.')] });
            if (moderatorMember.roles.highest.position <= targetMember.roles.highest.position) return interaction.editReply({ embeds: [error('You cannot ban a user with a role equal to or higher than your own.')] });
            if (!targetMember.bannable) return interaction.editReply({ embeds: [error('I do not have permission to ban this user (their role is likely higher than mine).')] });
        }
        
        let endsAt = null;
        let durationStrDisplay = 'Permanent';
        let dbDurationStr = null; 

        if (timeStr) {
            const durationMs = ms(timeStr);
            if (typeof durationMs !== 'number' || durationMs <= 0) return interaction.editReply({ embeds: [error('Invalid duration format.')] });
            endsAt = currentTimestamp + durationMs; 
            durationStrDisplay = timeStr;
            dbDurationStr = timeStr; 
        }

        const caseId = `CASE-${currentTimestamp}`;

      
        const appealChannelRes = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'banappeal'", [guildId]);
        const appealSystemActive = !!appealChannelRes.rows[0]?.channel_id;

        if (!appealSystemActive) {
            isAppealable = false; 
        }
        
        let dmSent = false; 
        const dmEmbed = new EmbedBuilder()
            .setColor(BAN_COLOR)
            .setTitle(`${emojis.ban} Ban from ${interaction.guild.name}`)
            .setDescription(`We regret to inform you that you have been **banned** from the server.`)
            .setThumbnail(interaction.guild.iconURL({ dynamic: true, size: 128 }))
            .addFields(
                { name: `${emojis.moderator} Moderator`, value: `${cleanModeratorTag}`, inline: true },
                { name: `${emojis.duration} Duration`, value: durationStrDisplay, inline: true },
                { name: `${emojis.reason} Reason`, value: `\`\`\`\n${cleanReason}\n\`\`\``, inline: false }
            )
            .setTimestamp();
        
        if (isAppealable && appealSystemActive) {
            dmEmbed.setFooter({ text: `Case ID: ${caseId} | You will need this if you decide to appeal!` });
            if (APPEAL_SERVER_INVITE) {
                dmEmbed.addFields({
                    name: '🗣️ How to Appeal',
                    value: `If you believe this was an error, you can submit an appeal by joining our appeals server: \n[**Click here to appeal**](${APPEAL_SERVER_INVITE})`
                });
            }
        } else {
            dmEmbed.setFooter({ text: `Case ID: ${caseId} | This punishment is NOT appealable or appeals are closed. 🚫` });
            dmEmbed.addFields({ name: '🚫 Appeal Status', value: 'This punishment cannot be appealed at this time.' });
        }

        try {
            const dmChannel = await targetUser.createDM().catch(() => null);
            if (dmChannel) {
                await dmChannel.send({ embeds: [dmEmbed] });
                dmSent = true; 
            }
        } catch (error) { dmSent = false; }

        try {
            const banReason = `[CMD] ${cleanReason} (Moderator: ${cleanModeratorTag}, Case ID: ${caseId})`;
            await interaction.guild.bans.create(targetUser.id, { reason: banReason, deleteMessageSeconds });
        } catch (err) {
            console.error('[ERROR] Failed to execute ban:', err);
            return interaction.editReply({ embeds: [error('An unexpected error occurred while trying to ban the user.')] });
        }

    
        await db.query(`
            INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, endsAt, action_duration, appealable, dmstatus, status) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `, [
            caseId, guildId, 'BAN', targetUser.id, targetUser.tag, 
            interaction.user.id, cleanModeratorTag, cleanReason, currentTimestamp, 
            endsAt, dbDurationStr, (!shouldBlacklist ? 1 : 0), dmSent ? 'SENT' : 'FAILED', endsAt ? 'ACTIVE' : 'PERMANENT'
        ]);

        if (endsAt) resumePunishmentsOnStart(interaction.client); 
        if (shouldBlacklist) await db.query("INSERT INTO appeal_blacklist (userid, guildid) VALUES ($1, $2) ON CONFLICT DO NOTHING", [targetUser.id, guildId]);

    
        const modLogResult = await db.query('SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2', [guildId, 'modlog']);
        if (modLogResult.rows[0]?.channel_id) {
            const channel = interaction.guild.channels.cache.get(modLogResult.rows[0].channel_id);
            if (channel) {
                  const modLogEmbed = new EmbedBuilder()
                    .setColor(BAN_COLOR)
                    .setAuthor({ name: `${targetUser.tag} has been BANNED`, iconURL: targetUser.displayAvatarURL({ dynamic: true }) })
                    .addFields(
                        { name: `${emojis.user} User`, value: `<@${targetUser.id}> (\`${targetUser.id}\`)`, inline: true },
                        { name: `${emojis.moderator} Moderator`, value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
                        { name: `${emojis.duration} Duration`, value: durationStrDisplay, inline: true },
                        { name: `${emojis.reason} Reason`, value: cleanReason, inline: false },
                        { name: `${emojis.dm_sent} DM Sent`, value: dmSent ? '✅ Yes' : '❌ No/Failed', inline: true }
                    )
                    .setTimestamp()
                    .setFooter({ text: `Case ID: ${caseId} | Appealable: ${(!shouldBlacklist && appealSystemActive) ? 'Yes' : 'No'}` });
                    
                const sentMessage = await channel.send({ embeds: [modLogEmbed] }).catch(e => console.error(`[ERROR] Failed to send modlog`));
                if (sentMessage) await db.query('UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2', [sentMessage.id, caseId]);
            }
        }
        
        const publicEmbed = success(`The user **${targetUser.tag}** has been **banned**.`)
            .setTitle(`${emojis.ban} Ban Executed`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 64 }))
            .addFields(
                { name: `${emojis.user} User`, value: `<@${targetUser.id}> (\`${targetUser.id}\`)`, inline: true },
                { name: `${emojis.moderator} Moderator`, value: `<@${interaction.user.id}>`, inline: true },
                { name: `${emojis.duration} Duration`, value: durationStrDisplay, inline: true },
                { name: `${emojis.case_id} Case ID`, value: `\`${caseId}\``, inline: true },
                { name: `${emojis.dm_sent} DM Status`, value: dmSent ? '✅ Sent' : '❌ Failed', inline: true },
                { name: '🗣️ Appealable', value: (!shouldBlacklist && appealSystemActive) ? '✅ Yes' : '❌ No/Closed', inline: true }
            )
            .setFooter({ text: `Reason: ${cleanReason.substring(0, 50)}${cleanReason.length > 50 ? '...' : ''}` });

        await interaction.editReply({ embeds: [publicEmbed] });
    },
};