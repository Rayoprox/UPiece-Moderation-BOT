const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');
const ms = require('ms');
const { emojis } = require('../../utils/config.js'); 
const { resumePunishmentsOnStart } = require('../../utils/temporary_punishment_handler.js');
const { success, error, moderation } = require('../../utils/embedFactory.js');

const APPEAL_SERVER_INVITE = process.env.DISCORD_APPEAL_INVITE_LINK;
const CALLBACK_URL = process.env.CALLBACK_URL || '';
const WEB_APPEAL_URL = CALLBACK_URL ? CALLBACK_URL.replace(/\/auth\/discord\/callback$/, '/appeal') : '';
const BAN_COLOR = 0xAA0000; 

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Bans a member from the server.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages) 
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
            let staffIds = [];
            
            // Intenta SELECT staff_roles; si no existe, usa fallback
            try {
                const guildSettingsResult = await db.query('SELECT staff_roles FROM guild_settings WHERE guildid = $1', [guildId]);
                const guildSettings = guildSettingsResult.rows[0];
                staffIds = guildSettings?.staff_roles ? guildSettings.staff_roles.split(',') : [];
            } catch (e) {
                if (e.message?.includes('staff_roles')) {
                    console.log('ℹ️  [ban.js] Columna staff_roles no existe aún en BD');
                    staffIds = [];
                } else {
                    throw e;
                }
            }
            
            if (targetMember.roles.cache.some(r => staffIds.includes(r.id))) return interaction.editReply({ embeds: [error('You cannot moderate a staff member.')] });
            if (moderatorMember.roles.highest.position <= targetMember.roles.highest.position) return interaction.editReply({ embeds: [error('You cannot ban a user with a role equal to or higher than your own.')] });
            if (!targetMember.bannable) return interaction.editReply({ embeds: [error('I do not have permission to ban this user (their role is likely higher than mine).')] });
        }
        
        let endsat = null;
        let durationStrDisplay = 'Permanent';
        let dbDurationStr = null; 

        if (timeStr) {
            const durationMs = ms(timeStr);
            if (typeof durationMs !== 'number' || durationMs <= 0) return interaction.editReply({ embeds: [error('Invalid duration format.')] });
            endsat = currentTimestamp + durationMs; 
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
            .setTitle(`Banned from ${interaction.guild.name}`)
            .setDescription(`You have been banned from **${interaction.guild.name}**.`)
            .addFields(
                { name: 'Reason', value: cleanReason, inline: false },
                { name: 'Duration', value: durationStrDisplay, inline: true }
            )
            .setTimestamp();
        
        if (isAppealable && appealSystemActive) {
            dmEmbed.setFooter({ text: `Case ID: ${caseId}` });

            let appealValue = '';
            if (WEB_APPEAL_URL) {
                appealValue += `🌐 [**Appeal on our Website**](${WEB_APPEAL_URL})`;
            }
            if (APPEAL_SERVER_INVITE) {
                if (appealValue) appealValue += '\n';
                appealValue += `💬 [**Appeal in our Support Server**](${APPEAL_SERVER_INVITE})`;
            }
            if (!appealValue) {
                appealValue = 'Contact staff to appeal (Case ID required)';
            }
            dmEmbed.addFields({ name: '📝 Appeal Your Ban', value: appealValue, inline: false });
        } else {
            dmEmbed.setFooter({ text: `Case ID: ${caseId} | Not Appealable` });
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
            INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, endsat, action_duration, appealable, dmstatus, status) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `, [
            caseId, guildId, 'BAN', targetUser.id, targetUser.tag, 
            interaction.user.id, cleanModeratorTag, cleanReason, currentTimestamp, 
            endsat, dbDurationStr, (!shouldBlacklist ? 1 : 0), dmSent ? 'SENT' : 'FAILED', endsat ? 'ACTIVE' : 'PERMANENT'
        ]);

        if (endsat) resumePunishmentsOnStart(interaction.client); 
        if (shouldBlacklist) await db.query("INSERT INTO appeal_blacklist (userid, guildid) VALUES ($1, $2) ON CONFLICT DO NOTHING", [targetUser.id, guildId]);

        const modLogResult = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'modlog'", [guildId]);
        if (modLogResult.rows[0]?.channel_id) {
            const channel = interaction.guild.channels.cache.get(modLogResult.rows[0].channel_id);
            if (channel) {
                  const modLogEmbed = new EmbedBuilder()
                    .setColor(BAN_COLOR)
                    .setTitle('Ban')
                    .addFields(
                        { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                        { name: 'Staff', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                        { name: 'Reason', value: cleanReason, inline: false },
                        { name: 'Duration', value: durationStrDisplay, inline: true }
                    )
                    .setFooter({ text: `Case ID: ${caseId}` })
                    .setTimestamp();
                    
                const sentMessage = await channel.send({ embeds: [modLogEmbed] }).catch(e => console.error(`[ERROR] Failed to send modlog`));
                if (sentMessage) await db.query('UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2', [sentMessage.id, caseId]);
            }
        }
        
        const publicEmbed = moderation(`**${targetUser.tag}** has been banned.\n**Reason:** ${cleanReason}`);
        await interaction.editReply({ embeds: [publicEmbed] });
    },
};
