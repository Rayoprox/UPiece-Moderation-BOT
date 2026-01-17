const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, RoleSelectMenuBuilder } = require('discord.js');
const db = require('../../../utils/db.js');
const { success, error } = require('../../../utils/embedFactory.js');
const { safeDefer } = require('../../../utils/interactionHelpers.js');
const guildCache = require('../../../utils/guildCache.js'); 

module.exports = async (interaction, client) => {
    const { customId, guild, values } = interaction;
    const guildId = guild.id;

    if (customId === 'setup_permissions_menu') {
        if (!await safeDefer(interaction, true)) return;
        
      
        const commands = client.commands.map(c => ({ label: `/${c.data.name}`, value: c.data.name })).slice(0, 25);

        const embed = new EmbedBuilder()
            .setTitle('🔐 Command Permissions')
            .setDescription('Select a command to strictly whitelist specific roles.\nIf no roles are set, the command uses default Discord permissions.')
            .setColor('#9B59B6');

        const menu = new StringSelectMenuBuilder()
            .setCustomId('setup_perm_select_cmd')
            .setPlaceholder('Select command to edit...')
            .addOptions(commands);

        const back = new ButtonBuilder().setCustomId('setup_home').setLabel('Back').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ 
            embeds: [embed], 
            components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(back)] 
        });
        return;
    }

    if (customId === 'setup_perm_select_cmd') {
        if (!await safeDefer(interaction, true)) return;
        const cmdName = values[0];

        const menu = new RoleSelectMenuBuilder()
            .setCustomId(`setup_perm_role_${cmdName}`)
            .setPlaceholder(`Select allowed roles for /${cmdName}`)
            .setMinValues(0)
            .setMaxValues(25);
        
        const back = new ButtonBuilder().setCustomId('setup_permissions_menu').setLabel('Back to List').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({
            content: `**Editing Permissions for:** \`/${cmdName}\`\nSelect the roles that can use this command. (Clear selection to reset).`,
            embeds: [],
            components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(back)]
        });
        return;
    }

    
    if (interaction.isRoleSelectMenu() && customId.startsWith('setup_perm_role_')) {
        if (!await safeDefer(interaction, true)) return;
        const cmdName = customId.replace('setup_perm_role_', '');
        
      
        await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
        
     
        for (const rId of values) {
            await db.query("INSERT INTO command_permissions (guildid, command_name, role_id) VALUES ($1, $2, $3)", [guildId, cmdName, rId]);
        }

       
        guildCache.flush(guildId);
        
        const back = new ButtonBuilder().setCustomId('setup_permissions_menu').setLabel('Back to Commands').setStyle(ButtonStyle.Primary);
        
        await interaction.editReply({ 
            embeds: [success(`Permissions for \`/${cmdName}\` updated.\nAllowed Roles: ${values.map(v => `<@&${v}>`).join(', ')}`)], 
            components: [new ActionRowBuilder().addComponents(back)] 
        });
        return;
    }
};