const { PermissionsBitField, EmbedBuilder } = require('discord.js');
const db = require('../utils/db.js');
const { SUPREME_IDS, STAFF_COMMANDS, emojis } = require('../utils/config.js');
const { safeDefer } = require('../utils/interactionHelpers.js');
const { error } = require('../utils/embedFactory.js');

async function executeCommand(interaction) {
    const { client, guild, user } = interaction;
    const command = client.commands.get(interaction.commandName);

    if (!command) return;

  
    const isPublic = command.isPublic ?? false;
    if (!await safeDefer(interaction, false, !isPublic)) return;


    if (SUPREME_IDS.includes(user.id)) {
        try { 
            await command.execute(interaction); 
            await sendCommandLog(interaction, db, true); // Log para Supreme
        } catch (e) { console.error(e); }
        return;
    }

    try {
        const [settingsRes, permsRes] = await Promise.all([
            db.query('SELECT universal_lock, staff_roles FROM guild_settings WHERE guildid = $1', [guild.id]),
            db.query('SELECT role_id FROM command_permissions WHERE guildid = $1 AND command_name = $2', [guild.id, command.data.name])
        ]);

        const universalLock = settingsRes.rows[0]?.universal_lock === true;
        const staffRolesStr = settingsRes.rows[0]?.staff_roles;
        const specificAllowedRoles = permsRes.rows.map(r => r.role_id);
        
        const memberRoles = interaction.member.roles.cache;
        const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
      
        const hasSpecificPermission = specificAllowedRoles.length > 0 && memberRoles.some(r => specificAllowedRoles.includes(r.id));
        let isStaff = false;
        if (staffRolesStr) {
            const staffRoleIds = staffRolesStr.split(',');
            isStaff = memberRoles.some(r => staffRoleIds.includes(r.id));
        }

        let isAllowed = false;
        let errorMessage = 'You do not have permission to use this command.';

        

        if (universalLock) {
          
            if (hasSpecificPermission) {
                isAllowed = true;
            } else {
                isAllowed = false;
                if (isAdmin) {
                    errorMessage = `**SECURITY LOCKDOWN:** Commands are disabled globally. Only Whitelisted Roles defined in \`/universalpanel\` can act.`;
                }
            }
        } else {
         
            if (isAdmin) {
                isAllowed = true;
            }
            else if (hasSpecificPermission) {
                isAllowed = true;
            }
            else if (isPublic) {
                isAllowed = true;
            }
         
            else if (isStaff && STAFF_COMMANDS.includes(command.data.name)) {
                isAllowed = true;
            }
        }

        if (!isAllowed) {
            return interaction.editReply({ 
                embeds: [error(errorMessage)], 
                content: null 
            });
        }

        await command.execute(interaction);

        
        await sendCommandLog(interaction, db, isAdmin);

    } catch (err) {
        console.error(`Error executing ${interaction.commandName}:`, err);
        const msg = { embeds: [error('An unexpected error occurred while executing this command!')], content: null };
        if (interaction.replied || interaction.deferred) await interaction.editReply(msg).catch(() => {});
    }
}


async function sendCommandLog(interaction, db, isAdmin) {
    try {
        const cmdLogResult = await db.query('SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2', [interaction.guild.id, 'cmdlog']);
        
        if (cmdLogResult.rows[0]?.channel_id) {
            const channel = interaction.guild.channels.cache.get(cmdLogResult.rows[0].channel_id);
            if (channel) {
                const fullCommandString = interaction.toString(); 

                const logEmbed = new EmbedBuilder()
                    .setColor(isAdmin ? 0x2B2D31 : 0x3498DB) 
                    .setAuthor({ 
                        name: 'Command Executed', 
                        iconURL: interaction.user.displayAvatarURL() 
                    })
                    .setDescription(`**Command:** \`${fullCommandString}\``)
                    .addFields(
                        { 
                            name: `${emojis.user || '👤'} User`, 
                            value: `${interaction.user} (\`${interaction.user.id}\`)`, 
                            inline: true 
                        },
                        { 
                            name: `${emojis.channel || '📺'} Channel`, 
                            value: `${interaction.channel} (\`${interaction.channel.id}\`)`, 
                            inline: true 
                        }
                    )
                    .setTimestamp();

                channel.send({ embeds: [logEmbed] }).catch(() => {}); 
            }
        }
    } catch (e) {
        console.warn('Failed to send command log:', e.message);
    }
}

module.exports = executeCommand;