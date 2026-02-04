const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../utils/db.js');
const { moderation } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('modstats')
        .setDescription('Shows moderation statistics for a staff member.')
        .addUserOption(option => option.setName('user').setDescription('The user to check the stats of.').setRequired(true)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const guildId = interaction.guild.id;

        const query = `SELECT caseid, action, status, moderatorid FROM modlogs WHERE guildid = $1 AND moderatorid = $2`;
        const params = [guildId, targetUser.id];
        
        const result = await db.query(query, params);
        const logs = result.rows;

        const counts = {
            'WARN': 0,
            'MUTE': 0,
            'UNMUTE': 0,
            'KICK': 0,
            'BAN': 0,
            'UNBAN': 0,
            'SOFTBAN': 0
        };

        for (const log of logs) {
            if (log.caseid.startsWith('AUTO-') || (log.status && log.status.startsWith('VOIDED'))) {
                continue;
            }

            const action = log.action;
            if (action === 'TIMEOUT') {
                counts['MUTE']++;
            } else if (counts.hasOwnProperty(action)) {
                counts[action]++;
            }
        }

        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle(`Moderation Stats for ${targetUser.username}`)
            .addFields(
                { name: 'Warns', value: counts['WARN'].toString(), inline: true },
                { name: 'Mutes', value: counts['MUTE'].toString(), inline: true },
                { name: 'Unmutes', value: counts['UNMUTE'].toString(), inline: true },
                { name: 'Kicks', value: counts['KICK'].toString(), inline: true },
                { name: 'Bans', value: counts['BAN'].toString(), inline: true },
                { name: 'Unbans', value: counts['UNBAN'].toString(), inline: true },
                { name: 'Softbans', value: counts['SOFTBAN'].toString(), inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
