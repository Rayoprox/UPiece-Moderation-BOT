const { PermissionsBitField, EmbedBuilder } = require('discord.js');
const { emojis, SUPREME_IDS } = require('../utils/config.js');
const { safeDefer } = require('../utils/interactionHelpers.js');

module.exports = async (interaction) => {
    const { client, guild, user, commandName } = interaction;
    const db = client.db;
    const command = client.commands.get(commandName);

    if (!command) return interaction.reply({ content: 'Error: Command not found.', ephemeral: true }).catch(() => {});

    // Defer inicial
    const isPublic = command.isPublic ?? false;
    if (!await safeDefer(interaction, false, !isPublic)) return;

    try {
        // --- 0. GOD MODE (SUPREME IDs) ---
        if (SUPREME_IDS.includes(user.id)) {
            await executeCommand(interaction, command, db, true);
            return;
        }

        // --- 1. LÓGICA NORMAL ---
        const [settingsRes, permsRes] = await Promise.all([
            db.query('SELECT universal_lock FROM guild_settings WHERE guildid = $1', [guild.id]),
            db.query('SELECT role_id FROM command_permissions WHERE guildid = $1 AND command_name = $2', [guild.id, command.data.name])
        ]);

        const universalLock = settingsRes.rows[0]?.universal_lock === true;
        const allowedRoles = permsRes.rows.map(r => r.role_id);
        const hasAllowedRole = allowedRoles.length > 0 && interaction.member.roles.cache.some(r => allowedRoles.includes(r.id));
        const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

        let isAllowed = false;
        let errorMessage = 'You do not have the required permissions for this command.';

        if (universalLock) {
            // >>> MODO LOCKDOWN <<<
            if (hasAllowedRole) {
                isAllowed = true;
            } else {
                isAllowed = false;
                if (isAdmin) {
                    errorMessage = `${emojis.lock} **SECURITY LOCKDOWN ACTIVE:** Even Administrators cannot use commands without explicit Whitelist Roles configured in \`/universalpanel\`.`;
                }
            }
        } else {
            // >>> MODO NORMAL <<<
            if (isAdmin || hasAllowedRole) {
                isAllowed = true;
            } else {
                if (command.data.default_member_permissions) {
                    isAllowed = interaction.member.permissions.has(command.data.default_member_permissions);
                } else {
                    isAllowed = true; 
                }
            }
        }

        if (!isAllowed) {
            return interaction.editReply({ content: errorMessage });
        }

        // Ejecutar si tiene permiso
        await executeCommand(interaction, command, db, false);

    } catch (dbError) {
        console.error('[ERROR] Permission check failed:', dbError);
        return interaction.editReply({ content: 'Database error checking permissions.' });
    }
};

async function executeCommand(interaction, command, db, isSupreme) {
    try {
        await command.execute(interaction); 
        const cmdLogResult = await db.query('SELECT channel_id FROM log_channels WHERE guildid = $1 AND log_type = $2', [interaction.guild.id, 'cmdlog']);
        if (cmdLogResult.rows[0]?.channel_id) {
            const channel = interaction.guild.channels.cache.get(cmdLogResult.rows[0].channel_id);
            if (channel) {
                const fullCommand = `/${interaction.commandName}`;
                const logEmbed = new EmbedBuilder()
                    .setColor(isSupreme ? 0xFFD700 : 0x3498DB)
                    .setTitle(isSupreme ? 'Command Executed (Supreme)' : 'Command Executed')
                    .setDescription(`Executed by <@${interaction.user.id}> in <#${interaction.channel.id}>`)
                    .addFields({ name: 'User', value: `${interaction.user.tag} (${interaction.user.id})` }, { name: 'Command', value: `\`${fullCommand}\`` })
                    .setTimestamp();
                channel.send({ embeds: [logEmbed] }).catch(() => {}); 
            }
        }
    } catch (error) {
        console.error(`[ERROR] /${interaction.commandName}:`, error);
        await interaction.editReply({ content: `${emojis.error} An error occurred!` }).catch(() => {});
    }
}