const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../utils/db.js');

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
        const now = Date.now();
        const last7 = now - (7 * 24 * 60 * 60 * 1000);
        const last30 = now - (30 * 24 * 60 * 60 * 1000);

        const stats = {
            warns: { d7: 0, d30: 0, all: 0 },
            mutes: { d7: 0, d30: 0, all: 0 },
            bans: { d7: 0, d30: 0, all: 0 },
            kicks: { d7: 0, d30: 0, all: 0 }
        };

        const increment = (bucket, timestamp) => {
            stats[bucket].all += 1;
            if (timestamp >= last30) stats[bucket].d30 += 1;
            if (timestamp >= last7) stats[bucket].d7 += 1;
        };

        for (const log of logs) {
            if (log.caseid?.startsWith('AUTO-') || (log.status && log.status.startsWith('VOIDED'))) {
                continue;
            }

            const action = log.action;
            const rawTs = Number(log.timestamp) || 0;
            const ts = rawTs > 0 && rawTs < 1000000000000 ? rawTs * 1000 : rawTs;

            if (action === 'WARN') {
                increment('warns', ts);
            } else if (action === 'TIMEOUT' || action === 'MUTE') {
                increment('mutes', ts);
            } else if (action === 'BAN' || action === 'SOFTBAN') {
                increment('bans', ts);
            } else if (action === 'KICK') {
                increment('kicks', ts);
            }
        }

        const total = {
            d7: stats.warns.d7 + stats.mutes.d7 + stats.bans.d7 + stats.kicks.d7,
            d30: stats.warns.d30 + stats.mutes.d30 + stats.bans.d30 + stats.kicks.d30,
            all: stats.warns.all + stats.mutes.all + stats.bans.all + stats.kicks.all
        };

        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('Moderation Statistics')
            .setDescription(
                `Mutes (last 7 days):\n${stats.mutes.d7}\n` +
                `Mutes (last 30 days):\n${stats.mutes.d30}\n` +
                `Mutes (all time):\n${stats.mutes.all}\n\n` +
                `Bans (last 7 days):\n${stats.bans.d7}\n` +
                `Bans (last 30 days):\n${stats.bans.d30}\n` +
                `Bans (all time):\n${stats.bans.all}\n\n` +
                `Kicks (last 7 days):\n${stats.kicks.d7}\n` +
                `Kicks (last 30 days):\n${stats.kicks.d30}\n` +
                `Kicks (all time):\n${stats.kicks.all}\n\n` +
                `Warns (last 7 days):\n${stats.warns.d7}\n` +
                `Warns (last 30 days):\n${stats.warns.d30}\n` +
                `Warns (all time):\n${stats.warns.all}\n\n` +
                `Total (last 7 days):\n${total.d7}\n` +
                `Total (last 30 days):\n${total.d30}\n` +
                `Total (all time):\n${total.all}`
            )
            .setFooter({ text: `Moderator: ${targetUser.tag}` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
