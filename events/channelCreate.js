const { Events, AuditLogEvent } = require('discord.js');
const antiNuke = require('../utils/antiNuke.js');
module.exports = {
    name: Events.ChannelCreate,
    async execute(channel) {
        if (!channel.guild) return;
        setTimeout(async () => {
            const logs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelCreate }).catch(() => null);
            if (!logs) return;
            const entry = logs.entries.first();
            if (!entry || Date.now() - entry.createdTimestamp > 5000) return;
            if (entry.executor.id === channel.client.user.id) return;
            await antiNuke.handleAction(channel.guild, entry.executor.id, 'CHANNEL_CREATE');
        }, 2000);
    },
};