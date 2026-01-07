const { Events } = require('discord.js');
const antiNuke = require('../utils/antiNuke.js');
module.exports = {
    name: Events.GuildRoleDelete,
    async execute(role) {
        if (!role.guild) return;
        setTimeout(async () => {
             const { AuditLogEvent } = require('discord.js');
             const logs = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).catch(() => null);
             if (!logs) return;
             const entry = logs.entries.first();
             if (!entry || Date.now() - entry.createdTimestamp > 5000) return;
             if (entry.executor.id === role.client.user.id) return;

             await antiNuke.handleAction(role.guild, entry.executor.id, 'ROLE_DELETE');
        }, 2000);
    },
};