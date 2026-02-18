const { PermissionsBitField, EmbedBuilder } = require('discord.js');
const { DEVELOPER_IDS, SUPREME_IDS, STAFF_COMMANDS } = require('./config.js');
const { error } = require('./embedFactory.js');
const guildCache = require('./guildCache.js');

async function checkCommandAvailability(guild, commandName, db, channelId = null) {
    const mainGuildId = process.env.DISCORD_GUILD_ID;
    if (!mainGuildId) return { available: true };

    try {
        const cmdSettingsRes = await db.query('SELECT enabled FROM command_settings WHERE guildid = $1 AND command_name = $2', [mainGuildId, commandName]);
        if (cmdSettingsRes.rows.length > 0 && cmdSettingsRes.rows[0].enabled === false) {
            return { available: false, reason: `⚠️ **Command \`${commandName}\` is Disabled**`, code: 'COMMAND_DISABLED' };
        }
    } catch (e) {
        if (!e.message?.includes('command_settings')) {
            console.error('[checkCommandAvailability] Error checking command settings:', e.message);
        }
    }

    try {
        const currentChannelId = channelId || (guild.channels.cache.get(guild.id)?.id || '');
        const ignoredRes = await db.query('SELECT ignored_channels FROM command_settings WHERE guildid = $1 AND command_name = $2', [mainGuildId, commandName]);
        if (ignoredRes.rows.length > 0 && ignoredRes.rows[0].ignored_channels) {
            const ignoredRaw = ignoredRes.rows[0].ignored_channels;
            const ignoredChannels = Array.isArray(ignoredRaw)
                ? ignoredRaw.filter(Boolean)
                : (typeof ignoredRaw === 'string' ? ignoredRaw.split(',').filter(Boolean) : []);
            if (ignoredChannels.includes(currentChannelId)) {
                return { available: false, reason: `⛔ **This channel is ignored for that command**`, code: 'CHANNEL_IGNORED' };
            }
        }
    } catch (e) {
        if (!e.message?.includes('command_settings')) {
            console.error('[checkCommandAvailability] Error checking ignored channels:', e.message);
        }
    }

    return { available: true };
}

async function validateCommandPermissions(client, guild, member, user, commandName, db, channelId = null) {
    const command = client.commands.get(commandName);
    if (!command) return { valid: false, reason: 'Command not found' };

    // 1. SUPREME → Bypass total
    if (SUPREME_IDS.includes(user.id)) {
        return { valid: true, isAdmin: true, bypass: true };
    }

    // License check (before everything)
    // Exclude license management commands from license verification
    const licenseCommands = ['redeem', 'generate_license', 'delete_license'];
    if (!licenseCommands.includes(command.data.name)) {
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

    // Developer → Bypass total
    if (DEVELOPER_IDS.includes(user.id)) {
        return { valid: true, isAdmin: true, bypass: true };
    }

    const mainGuildId = process.env.DISCORD_GUILD_ID;
    let guildData = guildCache.get(guild.id);
    
    if (!guildData) {
        let settingsRes, permsRes;
        try {
            settingsRes = await db.query('SELECT universal_lock FROM guild_settings WHERE guildid = $1', [mainGuildId]);
        } catch (e) {
            if (e.message?.includes('universal_lock')) {
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
    const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);

    // 2. LOCKDOWN LOGIC
    if (universalLock) {
        // Lockdown active: Admins eliminated from hierarchy, only specific roles allowed
        let allowed = false;
        const specificRoles = guildData.permissions
            .filter(p => p.command_name === commandName)
            .map(r => r.role_id);
        
        if (specificRoles.length > 0) {
            allowed = member.roles.cache.some(r => specificRoles.includes(r.id));
        }
        
        if (!allowed) {
            return { 
                valid: false, 
                reason: `**${guild.name} Lockdown Active.**\nAdmin permissions are temporarily suspended. Contact the Server Management.`
            };
        }
        return { valid: true, isAdmin: false };
    }

    // 3. NO LOCKDOWN → Admin bypass everything
    if (isAdmin) {
        return { valid: true, isAdmin: true };
    }

    // 4. Check if command is disabled
    try {
        const cmdSettingsRes = await db.query('SELECT enabled FROM command_settings WHERE guildid = $1 AND command_name = $2', [mainGuildId, commandName]);
        if (cmdSettingsRes.rows.length > 0 && cmdSettingsRes.rows[0].enabled === false) {
            return { valid: false, reason: `⚠️ **Command \`${commandName}\` is Disabled**` };
        }
    } catch (e) {
        if (!e.message?.includes('command_settings')) {
            console.error('[validateCommandPermissions] Error checking command settings:', e.message);
        }
    }

    // 5. Check if channel is ignored
    try {
        const currentChannelId = channelId || (guild.channels.cache.get(guild.id)?.id || '');
        const ignoredRes = await db.query('SELECT ignored_channels FROM command_settings WHERE guildid = $1 AND command_name = $2', [mainGuildId, commandName]);
        if (ignoredRes.rows.length > 0 && ignoredRes.rows[0].ignored_channels) {
            const ignoredRaw = ignoredRes.rows[0].ignored_channels;
            const ignoredChannels = Array.isArray(ignoredRaw)
                ? ignoredRaw.filter(Boolean)
                : (typeof ignoredRaw === 'string' ? ignoredRaw.split(',').filter(Boolean) : []);
            if (ignoredChannels.includes(currentChannelId)) {
                return { valid: false, reason: `⛔ **This channel is ignored for that command**` };
            }
        }
    } catch (e) {
        if (!e.message?.includes('command_settings')) {
            console.error('[validateCommandPermissions] Error checking ignored channels:', e.message);
        }
    }

    // 6. Check specific permissions
    const specificRoles = guildData.permissions
        .filter(p => p.command_name === commandName)
        .map(r => r.role_id);
    
    if (specificRoles.length > 0) {
        const hasSpecificPermission = member.roles.cache.some(r => specificRoles.includes(r.id));
        if (hasSpecificPermission) {
            return { valid: true, isAdmin: false };
        }
        // Has specific rules but doesn't have the role
        return { valid: false, reason: "You do not have permission to use this command." };
    }

    // 7. Check staff command with staff roles
    const isStaffCommand = STAFF_COMMANDS.includes(commandName);
    if (isStaffCommand) {
        const staffRaw = guildData.settings.staff_roles || '';
        const staffRoles = staffRaw ? staffRaw.split(',').filter(Boolean) : [];
        const hasStaffRole = staffRoles.length > 0 && member.roles.cache.some(r => staffRoles.includes(r.id));
        
        if (hasStaffRole) {
            return { valid: true, isAdmin: false };
        }
    }

    // 8. Check if public
    const isPublic = command.isPublic ?? false;
    if (isPublic) {
        return { valid: true, isAdmin: false };
    }

    // 9. Default deny
    return { valid: false, reason: "You do not have permission to use this command." };
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

module.exports = { checkCommandAvailability, validateCommandPermissions, sendCommandLog };
