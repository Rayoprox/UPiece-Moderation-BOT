const { PermissionsBitField, EmbedBuilder } = require('discord.js');
const { DEVELOPER_IDS, SUPREME_IDS, STAFF_COMMANDS } = require('./config.js');
const { error } = require('./embedFactory.js');
const guildCache = require('./guildCache.js');

async function validateCommandPermissions(client, guild, member, user, commandName, db) {
    const command = client.commands.get(commandName);
    if (!command) return { valid: false, reason: 'Command not found' };

    if (DEVELOPER_IDS.includes(user.id)) {
        return { valid: true, isAdmin: true, bypass: true };
    }

    if (command.data.name !== 'redeem') {
        const licRes = await db.query("SELECT expires_at FROM licenses WHERE guild_id = $1", [guild.id]);
        const hasLicense = licRes.rows.length > 0 && 
            (licRes.rows[0].expires_at === null || parseInt(licRes.rows[0].expires_at) > Date.now());
        
        if (!hasLicense) {
            return { 
                valid: false, 
                reason: "🔒 **License Required**\nThis server does not have an active license. Use `/redeem` to activate it." 
            };
        }
    }

    if (SUPREME_IDS.includes(user.id)) {
        return { valid: true, isAdmin: true, bypass: true };
    }

    let guildData = guildCache.get(guild.id);
    
    if (!guildData) {
        const mainGuildId = process.env.DISCORD_GUILD_ID;
        const mainGuildName = client.guilds.cache.get(mainGuildId)?.name || guild?.name || 'this server';
        
        let settingsRes, permsRes;
        
        // Intenta SELECT con universal_lock; si no existe, usa fallback
        try {
            settingsRes = await db.query('SELECT universal_lock FROM guild_settings WHERE guildid = $1', [mainGuildId]);
        } catch (e) {
            if (e.message?.includes('universal_lock')) {
                console.log('ℹ️  [logicHelper] Columna universal_lock no existe aún en BD');
                settingsRes = { rows: [{ universal_lock: false }] };
            } else {
                throw e;
            }
        }
        
        permsRes = await db.query('SELECT command_name, role_id FROM command_permissions WHERE guildid = $1', [mainGuildId]);
        
        guildData = { settings: settingsRes.rows[0] || {}, permissions: permsRes.rows };
        guildCache.set(guild.id, guildData);
    }

    const universalLock = guildData.settings.universal_lock === true;

    const specificRoles = guildData.permissions
        .filter(p => p.command_name === commandName)
        .map(r => r.role_id);
    
    let isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
    if (universalLock) isAdmin = false; 

    const hasSpecificRules = specificRoles.length > 0;
    const hasSpecificPermission = hasSpecificRules && member.roles.cache.some(r => specificRoles.includes(r.id));
    const isPublic = command.isPublic ?? false;
    const isStaffCommand = STAFF_COMMANDS.includes(commandName);

    let allowed = false;

    if (isAdmin) allowed = true;
    else if (hasSpecificRules) { 
        if (hasSpecificPermission) allowed = true; 
    }
    else if (!hasSpecificRules && isStaffCommand) {
        const staffRaw = guildData.settings.staff_roles || '';
        const staffRoles = staffRaw ? staffRaw.split(',').filter(Boolean) : [];
        const hasStaffRole = staffRoles.length > 0 && member.roles.cache.some(r => staffRoles.includes(r.id));
        if (hasStaffRole) allowed = true;
    }

    else if (isPublic) allowed = true;

    if (!allowed) {
        const msg = universalLock && member.permissions.has(PermissionsBitField.Flags.Administrator)
            ? `**${mainGuildName} Lockdown Active.**\nAdmin permissions are temporarily suspended. Contact the Server Management.`
            : "You do not have permission to use this command.";
        return { valid: false, reason: msg };
    }

    return { valid: true, isAdmin };
}

async function sendCommandLog(interaction, db, isAdmin) {
    try {
        if (!interaction.guild) return; 

        const cmdLogResult = await db.query('SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2', [interaction.guild.id, 'cmdlog']);
        if (!cmdLogResult.rows[0]?.channel_id) return;

        const channel = interaction.guild.channels.cache.get(cmdLogResult.rows[0].channel_id);
        if (!channel) return;

        const channelId = interaction.channelId || interaction.channel?.id || 'Unknown';
        const channelDisplay = interaction.channel ? interaction.channel.toString() : `<#${channelId}>`;

        const logEmbed = new EmbedBuilder()
            .setColor(isAdmin ? 0x2B2D31 : 0x3498DB) 
            .setAuthor({ name: 'Command Executed', iconURL: interaction.user.displayAvatarURL() })
            .setDescription(`**Command:** \`${interaction.toString()}\``)
            .addFields(
                { name: '👤 User', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true },
                { name: '📺 Channel', value: `${channelDisplay} (\`${channelId}\`)`, inline: true }
            )
            .setTimestamp();

        await channel.send({ embeds: [logEmbed] }).catch(() => {});
    } catch (e) {
        console.warn('[LOG-ERROR] Could not send command log:', e.message);
    }
}

module.exports = { validateCommandPermissions, sendCommandLog };
