const { Events, AuditLogEvent } = require('discord.js');
const antiNuke = require('../utils/antiNuke.js');
module.exports = {
    name: Events.GuildRoleCreate,
    async execute(role) {
        if (!role.guild) return;
        setTimeout(async () => {
            const logs = await role.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleCreate }).catch(() => null);
            if (!logs) return;
            const entry = logs.entries.first();
            if (!entry || Date.now() - entry.createdTimestamp > 5000) return;
            if (entry.executor.id === role.client.user.id) return;
            await antiNuke.handleAction(role.guild, entry.executor.id, 'ROLE_CREATE');
        }, 2000);
    },
};
