const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');
const { emojis } = require('../../utils/config.js'); 
const { moderation } = require('../../utils/embedFactory.js');

const SOFTBAN_COLOR = 0xE67E22; 

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('softban')
        .setDescription('Bans a member and immediately unbans them to clear their recent messages.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages) 
        .addUserOption(option => option.setName('user').setDescription('The user to softban (mention or ID).').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the softban and message deletion.').setRequired(true))
        .addStringOption(option => option.setName('delete_messages').setDescription('Select timeframe of messages to delete.')
            .addChoices(
                { name: 'Last hour', value: '3600' }, 
                { name: 'Last 24 hours', value: '86400' }, 
                { name: 'Last 7 days', value: '604800' }
            ).setRequired(true)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        const deleteMessageSeconds = parseInt(interaction.options.getString('delete_messages'), 10);
        const moderatorMember = interaction.member;
        const guildId = interaction.guild.id;
        const moderatorTag = interaction.user.tag;
        
        const cleanModeratorTag = moderatorTag.trim();
        const cleanReason = reason.trim();
        const currentTimestamp = Date.now();
        
        if (targetUser.id === interaction.user.id) return interaction.editReply({ content: `${emojis.error} You cannot softban yourself.`, flags: [MessageFlags.Ephemeral] });
        if (targetUser.id === interaction.client.user.id) return interaction.editReply({ content: `${emojis.error} You cannot softban me.`, flags: [MessageFlags.Ephemeral] });
        if (targetUser.id === interaction.guild.ownerId) return interaction.editReply({ content: `${emojis.error} You cannot softban the server owner.`, flags: [MessageFlags.Ephemeral] });

        const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

        if (targetMember) {
            const guildSettingsResult = await db.query('SELECT staff_roles FROM guild_settings WHERE guildid = $1', [guildId]);
            const staffIds = guildSettingsResult.rows[0]?.staff_roles ? guildSettingsResult.rows[0].staff_roles.split(',') : [];
            
            if (targetMember.roles.cache.some(r => staffIds.includes(r.id))) return interaction.editReply({ content: `${emojis.error} You cannot softban a staff member.`, flags: [MessageFlags.Ephemeral] });
            if (moderatorMember.roles.highest.position <= targetMember.roles.highest.position) return interaction.editReply({ content: `${emojis.error} You cannot softban a user with a role equal to or higher than your own.`, flags: [MessageFlags.Ephemeral] });
            if (!targetMember.bannable) return interaction.editReply({ content: `${emojis.error} I do not have permission to softban this user (their role is likely higher than mine).`, flags: [MessageFlags.Ephemeral] });
        }
        
        const softbanCaseId = `CASE-SB-${currentTimestamp}`;
        const banReason = `[CMD] SOFTBAN: ${cleanReason} (Moderator: ${cleanModeratorTag}, Case ID: ${softbanCaseId})`;
        
        let dmSent = false;
        try {
          
            const dmEmbed = new EmbedBuilder()
                .setColor(SOFTBAN_COLOR)
                .setTitle(`Softban Executed in ${interaction.guild.name}`)
                .setDescription(`Your recent messages have been deleted, and you have been temporarily banned and immediately unbanned.`)
                .addFields(
                    { name: 'Reason', value: cleanReason, inline: false }
                )
                .setFooter({ text: `Case ID: ${softbanCaseId} | You are free to rejoin.` })
                .setTimestamp();
        
            
            await targetUser.send({ embeds: [dmEmbed] });
            dmSent = true; 
        } catch (error) {
            dmSent = false; 
            console.warn(`[WARN] Could not send Softban DM to ${targetUser.tag}.`);
        }

        try {
            await interaction.guild.bans.create(targetUser.id, { reason: banReason, deleteMessageSeconds });
         
            await db.query(`
                INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, appealable, dmstatus, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `, [
                softbanCaseId, guildId, 'SOFTBAN', targetUser.id, targetUser.tag, 
                interaction.user.id, cleanModeratorTag, cleanReason, currentTimestamp, 0, dmSent ? 'SENT' : 'FAILED', 'EXECUTED'
            ]);
         
            const modLogResult = await db.query('SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2', [guildId, 'modlog']);
            const modLogChannelId = modLogResult.rows[0]?.channel_id;

            if (modLogChannelId) {
                const channel = interaction.guild.channels.cache.get(modLogChannelId);
                if (channel) {
                      const modLogEmbed = new EmbedBuilder()
                        .setColor(SOFTBAN_COLOR)
                        .setTitle('Softban')
                        .addFields(
                            { name: 'User', value: `${targetUser.tag} (${targetUser.id})`, inline: true },
                            { name: 'Staff', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                            { name: 'Messages Deleted', value: `${deleteMessageSeconds / 3600} hours`, inline: true },
                            { name: 'Reason', value: cleanReason, inline: false }
                        )
                        .setTimestamp()
                        .setFooter({ text: `Case ID: ${softbanCaseId}` });
                        
                    const sentSoftbanLog = await channel.send({ embeds: [modLogEmbed] }).catch(e => console.error(`[ERROR] Failed to send softban modlog: ${e}`));
                    
                    if (sentSoftbanLog) {
                        await db.query('UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2', [sentSoftbanLog.id, softbanCaseId]);
                    }
                }
            }
            
            const unbanReason = `[CMD] Auto-Unban after Softban (Moderator: ${cleanModeratorTag}, Case ID: ${softbanCaseId})`;
            await interaction.guild.bans.remove(targetUser.id, unbanReason); 
         
            const unbanCaseId = `AUTO-UNBAN-SB-${Date.now()}`;
            await db.query(`
                INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, appealable, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            `, [unbanCaseId, guildId, 'UNBAN', targetUser.id, targetUser.tag, interaction.client.user.id, interaction.client.user.tag, `Auto-lift Softban (Case ID: ${softbanCaseId})`, Date.now(), 0, 'EXECUTED']);


        } catch (error) {
            console.error('[ERROR] Failed to execute Softban:', error);
          
            interaction.guild.bans.fetch(targetUser.id).then(() => interaction.guild.bans.remove(targetUser.id, 'Softban failed to complete. Automatic unban triggered.')).catch(() => {});
            
            return interaction.editReply({ content: `${emojis.error} An unexpected error occurred while executing the Softban. Please check my permissions. The user may be temporarily banned or not banned.`, flags: [MessageFlags.Ephemeral] });
        }

        const publicEmbed = moderation(`**${targetUser.tag}** has been softbanned.\n**Reason:** ${cleanReason}`);
        await interaction.editReply({ embeds: [publicEmbed] });
    },
};