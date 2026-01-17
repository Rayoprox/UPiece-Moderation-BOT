const { PermissionsBitField, EmbedBuilder } = require('discord.js');
const db = require('../utils/db.js');
const { SUPREME_IDS, STAFF_COMMANDS, emojis } = require('../utils/config.js');
const { safeDefer } = require('../utils/interactionHelpers.js');
const { error } = require('../utils/embedFactory.js');
const guildCache = require('../utils/guildCache.js'); 

async function executeCommand(interaction, client) { 
    const botClient = client || interaction.client;
    const command = botClient.commands.get(interaction.commandName);
    if (!command) return;

    const { guild, user, member } = interaction;
    const isPublic = command.isPublic ?? false;

    if (!await safeDefer(interaction, false, !isPublic)) return;


    if (SUPREME_IDS.includes(user.id)) {
        try { 
            await command.execute(interaction); 
            sendCommandLog(interaction, db, true).catch(console.error); 
        } catch (e) { console.error(e); }
        return;
    }

    try {
      
        let guildData = guildCache.get(guild.id);

        if (!guildData) {
         
            const [settingsRes, permsRes] = await Promise.all([
                db.query('SELECT universal_lock, staff_roles FROM guild_settings WHERE guildid = $1', [guild.id]),
                db.query('SELECT command_name, role_id FROM command_permissions WHERE guildid = $1', [guild.id])
            ]);

            guildData = {
                settings: settingsRes.rows[0] || {},
                permissions: permsRes.rows
            };
            
       
            guildCache.set(guild.id, guildData);
        }
      

        const settings = guildData.settings;
        const universalLock = settings.universal_lock === true;
        const staffRoles = settings.staff_roles ? settings.staff_roles.split(',').filter(r => r) : [];
        
        const specificAllowedRoles = guildData.permissions
            .filter(p => p.command_name === command.data.name)
            .map(r => r.role_id);
        
        const memberRoles = member.roles.cache;
        const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
        const isGlobalStaff = memberRoles.some(r => staffRoles.includes(r.id));
        const hasSpecificPermission = specificAllowedRoles.length > 0 && memberRoles.some(r => specificAllowedRoles.includes(r.id));

        let isAllowed = false;
        let errorMessage = '⛔ You do not have permission to use this command.';

        if (universalLock) {
            if (isAdmin || isGlobalStaff || hasSpecificPermission) isAllowed = true;
            else {
                isAllowed = false;
                errorMessage = `🔒 **Security Lockdown Active**\nOnly Staff & Whitelisted roles can use commands.`;
            }
        } else {
            if (isAdmin || hasSpecificPermission || isPublic) isAllowed = true; 
            else if (isGlobalStaff && STAFF_COMMANDS.includes(command.data.name)) isAllowed = true;
        }

        if (!isAllowed) {
            return interaction.editReply({ embeds: [error(errorMessage)], content: null });
        }
    
        await command.execute(interaction);
        sendCommandLog(interaction, db, isAdmin).catch(console.warn);

    } catch (err) {
        console.error(`Error executing ${interaction.commandName}:`, err);
        if (interaction.replied || interaction.deferred) await interaction.editReply({ embeds: [error('An unexpected error occurred!')] }).catch(() => {});
    }
}

async function sendCommandLog(interaction, db, isAdmin) {
 
    try {
        const cmdLogResult = await db.query('SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2', [interaction.guild.id, 'cmdlog']);
        if (cmdLogResult.rows[0]?.channel_id) {
            const channel = interaction.guild.channels.cache.get(cmdLogResult.rows[0].channel_id);
            if (channel) {
                const logEmbed = new EmbedBuilder()
                    .setColor(isAdmin ? 0x2B2D31 : 0x3498DB) 
                    .setAuthor({ name: 'Command Executed', iconURL: interaction.user.displayAvatarURL() })
                    .setDescription(`**Command:** \`${interaction.toString()}\``)
                    .addFields(
                        { name: '👤 User', value: `${interaction.user} (\`${interaction.user.id}\`)`, inline: true },
                        { name: '📺 Channel', value: `${interaction.channel} (\`${interaction.channel.id}\`)`, inline: true }
                    )
                    .setTimestamp();
                channel.send({ embeds: [logEmbed] }).catch(() => {}); 
            }
        }
    } catch (e) {}
}

module.exports = executeCommand;