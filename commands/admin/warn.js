const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');
const ms = require('ms');
const { resumePunishmentsOnStart } = require('../../utils/temporary_punishment_handler.js');
const { emojis } = require('../../utils/config.js'); 
const { success, error } = require('../../utils/embedFactory.js'); // IMPORTAMOS LA FÁBRICA

const APPEAL_SERVER_INVITE = process.env.DISCORD_APPEAL_INVITE_LINK;
const WARN_COLOR = 0xFFD700;
const AUTOMOD_COLOR = 0xAA0000;

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Issues a warning to a user.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
        .addUserOption(option => option.setName('user').setDescription('The user to warn.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the warning.').setRequired(false)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason specified';
        const moderatorMember = interaction.member;
        const guildId = interaction.guild.id;
        const moderatorTag = interaction.user.tag;
        
        const cleanModeratorTag = moderatorTag.trim();
        const cleanReason = reason.trim();
        const currentTimestamp = Date.now();

       
        if (targetUser.id === interaction.user.id) return interaction.editReply({ embeds: [error('You cannot warn yourself.')] });
        if (targetUser.id === interaction.client.user.id) return interaction.editReply({ embeds: [error('You cannot warn me.')] });
        if (targetUser.id === interaction.guild.ownerId) return interaction.editReply({ embeds: [error('You cannot warn the server owner.')] });
        
        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        if (targetMember) {
            const guildSettingsResult = await db.query('SELECT staff_roles FROM guild_settings WHERE guildid = $1', [guildId]);
            const staffIds = guildSettingsResult.rows[0]?.staff_roles ? guildSettingsResult.rows[0].staff_roles.split(',') : [];
            if (targetMember.roles.cache.some(r => staffIds.includes(r.id))) return interaction.editReply({ embeds: [error('You cannot moderate a staff member.')] });
            if (moderatorMember.roles.highest.position <= targetMember.roles.highest.position) return interaction.editReply({ embeds: [error('You cannot warn a user with a role equal to or higher than your own.')] });
        }

        const caseId = `CASE-${currentTimestamp}`;
        let dmSent = false;
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor(WARN_COLOR)
                .setTitle(`${emojis.warn} Official Warning Issued in ${interaction.guild.name}`)
                .setDescription(`This is an official warning regarding your recent conduct.`)
                .addFields(
                    { name: `${emojis.moderator} Moderator`, value: cleanModeratorTag }, 
                    { name: `${emojis.reason} Reason`, value: `\`\`\`${cleanReason}\`\`\`` }
                )
                .setFooter({ text: `Case ID: ${caseId}` })
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] });
            dmSent = true;
        } catch (error) { console.warn(`[WARN] Could not send Manual Warn DM`); }

        await db.query(`INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, status, dmstatus) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [caseId, guildId, 'WARN', targetUser.id, targetUser.tag, interaction.user.id, cleanModeratorTag, cleanReason, currentTimestamp, 'ACTIVE', dmSent ? 'SENT' : 'FAILED']);

        const countResult = await db.query("SELECT COUNT(*) as count FROM modlogs WHERE userid = $1 AND guildid = $2 AND action = 'WARN' AND status = 'ACTIVE'", [targetUser.id, guildId]);
        const activeWarningsCount = Number(countResult.rows[0].count);

 
        const modLogResult = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = 'modlog'", [guildId]);
        if (modLogResult.rows[0]?.channel_id) {
            const modLogChannel = interaction.guild.channels.cache.get(modLogResult.rows[0].channel_id);
            if (modLogChannel) {
                const warnLogEmbed = new EmbedBuilder()
                    .setColor(WARN_COLOR)
                    .setAuthor({ name: `${targetUser.tag} has been WARNED`, iconURL: targetUser.displayAvatarURL({ dynamic: true }) })
                    .addFields(
                        { name: `${emojis.user} User`, value: `<@${targetUser.id}> (\`${targetUser.id}\`)`, inline: true },
                        { name: `${emojis.moderator} Moderator`, value: `<@${interaction.user.id}> (\`${interaction.user.id}\`)`, inline: true },
                        { name: `${emojis.warn} Active Warnings`, value: `${activeWarningsCount}`, inline: true },
                        { name: `${emojis.reason} Reason`, value: cleanReason, inline: false },
                        { name: `${emojis.dm_sent} DM Sent`, value: dmSent ? '✅ Yes' : '❌ No/Failed', inline: true }
                    )
                    .setFooter({ text: `Case ID: ${caseId}` })
                    .setTimestamp();
                const sent = await modLogChannel.send({ embeds: [warnLogEmbed] }).catch(console.error);
                if(sent) await db.query('UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2', [sent.id, caseId]);
            }
        }

        let finalReplyEmbed;
    
        const ruleResult = await db.query('SELECT * FROM automod_rules WHERE guildid = $1 AND warnings_count = $2', [guildId, activeWarningsCount]);
        const ruleToExecute = ruleResult.rows[0];

        if (ruleToExecute && targetMember) {
            const action = ruleToExecute.action_type;
            const durationStr = ruleToExecute.action_duration;
            const autoCaseId = `AUTO-${Date.now()}`;
            const autoReason = `Automod: Triggered by reaching ${activeWarningsCount} warnings.`;
            let endsAt = null;
            let autoDmSent = false;

            try {
                if (action === 'BAN' || action === 'TIMEOUT') {
                    const actionEmoji = action === 'BAN' ? emojis.ban : emojis.mute;
                    const dmPunishmentEmbed = new EmbedBuilder()
                        .setColor(AUTOMOD_COLOR)
                        .setTitle(`${emojis.rules} Automated Action from ${interaction.guild.name}`)
                        .setDescription(`Due to accumulating **${activeWarningsCount} active warnings**, an automated punishment has been applied to you.`)
                        .setThumbnail(interaction.guild.iconURL({ dynamic: true, size: 128 }))
                        .addFields(
                            { name: `${emojis.moderator} Moderator`, value: `${interaction.client.user.tag} (Automod)`, inline: true },
                            { name: `${emojis.duration} Duration`, value: durationStr || (action === 'BAN' ? 'Permanent' : 'Timed'), inline: true },
                            { name: `${actionEmoji} Action`, value: action, inline: true},
                            { name: `${emojis.reason} Reason`, value: `\`\`\`\n${autoReason}\n\`\`\``, inline: false }
                        );

                    if (action === 'BAN' && APPEAL_SERVER_INVITE) {
                        dmPunishmentEmbed.setFooter({ text: `Case ID: ${autoCaseId} | Appeal Code` });
                        dmPunishmentEmbed.addFields({ name: '🗣️ Appeal', value: `[Appeal Here](${APPEAL_SERVER_INVITE})` });
                    }
                    await targetUser.send({ embeds: [dmPunishmentEmbed] });
                    autoDmSent = true;
                }
            } catch (e) { }

            try {
                if ((action === 'MUTE' || action === 'TIMEOUT' || action === 'BAN') && durationStr) {
                    const durationMs = ms(durationStr);
                    if (durationMs) endsAt = Date.now() + durationMs;
                }
                const dbAction = (action === 'MUTE' || action === 'TIMEOUT') ? 'TIMEOUT' : action;
                await db.query(`INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, "endsat", action_duration, status, dmstatus) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, [autoCaseId, guildId, dbAction, targetUser.id, targetUser.tag, interaction.client.user.id, interaction.client.user.tag, autoReason, Date.now(), endsAt, durationStr, 'ACTIVE', autoDmSent ? 'SENT' : 'FAILED']);
                if (endsAt) resumePunishmentsOnStart(interaction.client);
                
                if (action === 'KICK') await targetMember.kick(autoReason);
                else if (action === 'BAN') await interaction.guild.bans.create(targetUser.id, { reason: autoReason });
                else if (action === 'MUTE' || action === 'TIMEOUT') {
                    const durationMs = ms(durationStr);
                    if (durationMs) await targetMember.timeout(durationMs, autoReason);
                }

               
                finalReplyEmbed = new EmbedBuilder()
                    .setColor(AUTOMOD_COLOR)
                    .setTitle(`${emojis.rules} Automod Triggered: ${action}`)
                    .setDescription(`**${targetUser.tag}** was warned, reaching **${activeWarningsCount}** warnings and triggering an automatic action.`)
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 64 }))
                    .addFields(
                        { name: `${emojis.moderator} Moderator (Warn)`, value: `<@${interaction.user.id}>`, inline: true },
                        { name: `${emojis.rules} Punishment`, value: `${action}`, inline: true },
                        { name: `${emojis.duration} Duration`, value: durationStr || 'Permanent', inline: true },
                        { name: `${emojis.case_id} Warn Case ID`, value: `\`${caseId}\``, inline: false },
                        { name: `${emojis.case_id} Automod Case ID`, value: `\`${autoCaseId}\``, inline: false }
                    )
                    .setTimestamp();
            } catch (autoError) {
                console.error('[ERROR] AUTOMOD FAILED:', autoError);
                finalReplyEmbed = success(`**${targetUser.tag}** warned, but automated **${action}** failed.`)
                    .setTitle(`${emojis.success} Warning Issued (Automod Failed)`);
            }
        }

        if (!finalReplyEmbed) {
         
            finalReplyEmbed = success(`**${targetUser.tag}** has been warned.`)
                .setTitle(`${emojis.success} Warning Successfully Issued`)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 64 }))
                .addFields(
                    { name: `${emojis.moderator} Moderator`, value: `<@${interaction.user.id}>`, inline: true },
                    { name: `${emojis.warn} Active Warnings`, value: `${activeWarningsCount}`, inline: true },
                    { name: `${emojis.case_id} Case ID`, value: `\`${caseId}\``, inline: true }
                )
                .setFooter({ text: `Reason: ${cleanReason.substring(0, 100)}${cleanReason.length > 100 ? '...' : ''}` });
        }
        
        await interaction.editReply({ embeds: [finalReplyEmbed] });
    },
};