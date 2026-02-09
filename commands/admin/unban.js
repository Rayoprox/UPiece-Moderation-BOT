const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const db = require('../../utils/db.js');
const { emojis } = require('../../utils/config.js');
const { success, error, moderation } = require('../../utils/embedFactory.js');

const UNBAN_COLOR = 0x2ECC71; // Verde (Acción positiva)

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Removes a ban from a user.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
        .addStringOption(option => option.setName('user_id').setDescription('The ID of the user to unban.').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('The reason for the unban.').setRequired(false)),

    async execute(interaction) {
        const targetId = interaction.options.getString('user_id');
        const reason = interaction.options.getString('reason') || 'No reason specified';
        const guild = interaction.guild;
        const guildId = interaction.guild.id;

        const cleanReason = reason.trim();
        const currentTimestamp = Date.now();

        if (!/^\d{17,19}$/.test(targetId)) return interaction.editReply({ embeds: [error('Please provide a valid user ID.')] });

        let ban;
        try {
            ban = await guild.bans.fetch(targetId);
        } catch (err) {
            if (err.code === 10026) return interaction.editReply({ embeds: [error(`User with ID \`${targetId}\` is not banned.`)] });
            console.error('Failed to fetch ban:', err);
            return interaction.editReply({ embeds: [error('An unexpected error occurred while checking the ban list.')] });
        }

        try {
            await guild.members.unban(targetId, `[CMD] ${cleanReason} (Moderator: ${interaction.user.tag})`);
        } catch (err) {
            console.error('Failed to unban user:', err);
            return interaction.editReply({ embeds: [error('An error occurred while trying to unban this user.')] });
        }

        const activeBansResult = await db.query(`SELECT caseid FROM modlogs WHERE guildid = $1 AND userid = $2 AND status = 'ACTIVE' AND action = 'BAN'`, [guildId, targetId]);
        for (const row of activeBansResult.rows) {
            if (interaction.client.punishmentTimers.has(row.caseid)) {
                clearTimeout(interaction.client.punishmentTimers.get(row.caseid));
                interaction.client.punishmentTimers.delete(row.caseid);
            }
        }

        await db.query(`UPDATE modlogs SET status = $1, endsat = NULL WHERE guildid = $2 AND userid = $3 AND status = $4 AND action = $5`, ['EXPIRED', guildId, targetId, 'ACTIVE', 'BAN']);

        const unbanCaseId = `CASE-${currentTimestamp}`;
        await db.query(`INSERT INTO modlogs (caseid, guildid, action, userid, usertag, moderatorid, moderatortag, reason, timestamp, appealable, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [unbanCaseId, guildId, 'UNBAN', ban.user.id, ban.user.tag, interaction.user.id, interaction.user.tag, cleanReason, currentTimestamp, 0, 'EXECUTED']);

        const modLogResult = await db.query("SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2", [guildId, 'modlog']);
        if (modLogResult.rows[0]?.channel_id) {
            const channel = guild.channels.cache.get(modLogResult.rows[0].channel_id);
            if (channel) {
                const modLogEmbed = new EmbedBuilder()
                    .setColor(UNBAN_COLOR)
                    .setTitle('Unban')
                    .addFields(
                        { name: 'User', value: `${ban.user.tag} (${targetId})`, inline: true },
                        { name: 'Staff', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
                        { name: 'Reason', value: cleanReason, inline: false }
                    )
                    .setFooter({ text: `Case ID: ${unbanCaseId}` })
                    .setTimestamp();

                const sentMessage = await channel.send({ embeds: [modLogEmbed] }).catch(console.error);
                if (sentMessage) await db.query("UPDATE modlogs SET logmessageid = $1 WHERE caseid = $2", [sentMessage.id, unbanCaseId]);
            }
        }
        
        const publicEmbed = moderation(`**${ban.user.tag}** has been unbanned.\n**Reason:** ${cleanReason}`);
        await interaction.editReply({ embeds: [publicEmbed] });
    },
};
