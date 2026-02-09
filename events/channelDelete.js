const { Events } = require('discord.js');
const antiNuke = require('../utils/antiNuke.js');
module.exports = {
    name: Events.ChannelDelete,
    async execute(channel) {
        if (!channel.guild) return;
        setTimeout(async () => { 
             
             const { AuditLogEvent } = require('discord.js');
             const logs = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
             if (!logs) return;
             const entry = logs.entries.first();
             if (!entry || Date.now() - entry.createdTimestamp > 5000) return;
             if (entry.executor.id === channel.client.user.id) return;

             await antiNuke.handleAction(channel.guild, entry.executor.id, 'CHANNEL_DELETE');
        }, 2000);
    },
};
