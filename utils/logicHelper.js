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
        const [settingsRes, permsRes] = await Promise.all([
            db.query('SELECT universal_lock, staff_roles FROM guild_settings WHERE guildid = $1', [guild.id]),
            db.query('SELECT command_name, role_id FROM command_permissions WHERE guildid = $1', [guild.id])
        ]);
        guildData = { settings: settingsRes.rows[0] || {}, permissions: permsRes.rows };
        guildCache.set(guild.id, guildData);
    }

    const universalLock = guildData.settings.universal_lock === true;
    const staffRoles = guildData.settings.staff_roles?.split(',') || [];
    const specificRoles = guildData.permissions.filter(p => p.command_name === commandName).map(r => r.role_id);
    
    let isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
    
 
    if (universalLock) isAdmin = false; 

    const isGlobalStaff = member.roles.cache.some(r => staffRoles.includes(r.id));
    const hasSpecificRules = specificRoles.length > 0;
    const hasSpecificPermission = hasSpecificRules && member.roles.cache.some(r => specificRoles.includes(r.id));
    const isPublic = command.isPublic ?? false;

    let allowed = false;

    if (isAdmin) allowed = true;
    else if (hasSpecificRules) { if (hasSpecificPermission) allowed = true; }
    else if (isGlobalStaff && STAFF_COMMANDS.includes(commandName)) allowed = true;
    else if (isPublic) allowed = true;

    if (!allowed) {
        const msg = universalLock && member.permissions.has(PermissionsBitField.Flags.Administrator)
            ? "🔒 **Universal Lockdown Active.**\nAdmin permissions are temporarily suspended. Contact the Server Owners."
            : "⛔ You do not have permission to use this command.";
        return { valid: false, reason: msg };
    }

    return { valid: true, isAdmin };
}

async function sendCommandLog(interaction, db, isAdmin) {
    try {
        const cmdLogResult = await db.query('SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2', [interaction.guild.id, 'cmdlog']);
        if (!cmdLogResult.rows[0]?.channel_id) return;

        const channel = interaction.guild.channels.cache.get(cmdLogResult.rows[0].channel_id);
        if (!channel) return;

        const logEmbed = new EmbedBuilder()
            .setColor(isAdmin ? 0x2B2D31 : 0x3498DB) 
            .setAuthor({ name: 'Command Executed', iconURL: interaction.user.displayAvatarURL() })
            .setDescription(`**Command:** \`${interaction.toString()}\``)
            .addFields(
                { name: '👤 User', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true },
                { name: '📺 Channel', value: `${interaction.channel} (\`${interaction.channel.id}\`)`, inline: true }
            )
            .setTimestamp();

        await channel.send({ embeds: [logEmbed] }).catch(() => {});
    } catch (e) {
        console.warn('[LOG-ERROR] Could not send command log:', e.message);
    }
}

module.exports = { validateCommandPermissions, sendCommandLog };