const { ActionRowBuilder, RoleSelectMenuBuilder, EmbedBuilder } = require('discord.js');

async function handleCommandSelect(interaction) {
    

    const commandName = interaction.values[0];
    const db = interaction.client.db;


    const allowedRolesResult = await db.query('SELECT role_id FROM command_permissions WHERE command_name = $1', [commandName]);
    const allowedRoles = allowedRolesResult.rows; 
    
    let rolesList = allowedRoles.map(r => `<@&${r.role_id}>`).join('\n') || 'None yet.';

    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`🛡️ Permissions for /${commandName}`)
        .setDescription(`Select the roles that should be allowed to use this command.\nCurrent allowed roles:\n${rolesList}`);

    const roleSelector = new RoleSelectMenuBuilder()
        .setCustomId(`perms_role_select_${commandName}`)
        .setPlaceholder('Select roles...')
        .setMinValues(0)
        .setMaxValues(10);

    const actionRow = new ActionRowBuilder().addComponents(roleSelector);

   
    return { embeds: [embed], components: [actionRow] };
}

module.exports = { handleCommandSelect };