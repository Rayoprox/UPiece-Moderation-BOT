const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, RoleSelectMenuBuilder } = require('discord.js');
const db = require('../../../utils/db.js');
const { success, error } = require('../../../utils/embedFactory.js');
const { safeDefer } = require('../../../utils/interactionHelpers.js');
const guildCache = require('../../../utils/guildCache.js'); 

module.exports = async (interaction) => {
    const { customId, guild, client, values } = interaction;
    const guildId = guild.id;

    if (customId === 'setup_permissions' || customId === 'setup_permissions_menu') {
        if (!await safeDefer(interaction, true)) return;
        
        const res = await db.query("SELECT command_name, role_id FROM command_permissions WHERE guildid = $1 ORDER BY command_name", [guildId]);
        
        const perms = {};
        res.rows.forEach(r => { 
            if (!perms[r.command_name]) perms[r.command_name] = []; 
            perms[r.command_name].push(r.role_id); 
        });

        let description = Object.keys(perms).length === 0 
            ? '`No specific command permissions configured.`' 
            : Object.entries(perms).map(([cmd, roles]) => `**/${cmd}**: ${roles.map(r => `<@&${r}>`).join(', ')}`).join('\n');
        
        const embed = new EmbedBuilder()
            .setTitle('🔐 Command Permissions Config')
            .setDescription(`Specific role overrides for commands (Bypass defaults & Lockdown).\n\n${description}`)
            .setColor(0xE74C3C);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_perms_edit_select').setLabel('Add/Edit Override').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
            new ButtonBuilder().setCustomId('setup_perms_delete').setLabel('Delete').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
            new ButtonBuilder().setCustomId('setup_home').setLabel('Back').setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
        return;
    }

    if (customId === 'setup_perms_edit_select') {
        if (!await safeDefer(interaction, true)) return;
        
        const allCommands = client.commands
            .filter(c => c.data.name !== 'setup' && c.category !== 'developer')
            .map(c => ({ label: `/${c.data.name}`, value: c.data.name }))
            .sort((a, b) => a.label.localeCompare(b.label));

        const chunkedCommands = [];
        for (let i = 0; i < allCommands.length; i += 25) {
            chunkedCommands.push(allCommands.slice(i, i + 25));
        }

        const components = [];
        chunkedCommands.forEach((chunk, index) => {
            const menu = new StringSelectMenuBuilder()
                .setCustomId(`select_command_perms_${index}`)
                .setPlaceholder(`Select command to edit... (Page ${index + 1})`)
                .addOptions(chunk);
            components.push(new ActionRowBuilder().addComponents(menu));
        });
        
        const backButton = new ButtonBuilder().setCustomId('setup_permissions').setLabel('⬅️ Back to View').setStyle(ButtonStyle.Secondary);
        components.push(new ActionRowBuilder().addComponents(backButton));

        await interaction.editReply({ 
            embeds: [new EmbedBuilder().setTitle('✏️ Select Command').setDescription('Which command do you want to modify permissions for?\nThe command list is split into multiple pages if it exceeds 25.')], 
            components: components
        });
        return;
    }

  
    if (customId === 'setup_perms_delete') {
        if (!await safeDefer(interaction, true)) return;
        
        const res = await db.query("SELECT DISTINCT command_name FROM command_permissions WHERE guildid = $1", [guildId]);
        
        if (res.rows.length === 0) {
            return interaction.editReply({ 
                embeds: [error("No custom permissions configured to delete.")], 
                components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_permissions').setLabel('Back').setStyle(ButtonStyle.Secondary))]
            });
        }

        const options = res.rows.map(r => ({ label: `Reset /${r.command_name}`, value: r.command_name, emoji: '🗑️' })).slice(0, 25);
        
        const menu = new StringSelectMenuBuilder()
            .setCustomId('select_delete_perm')
            .setPlaceholder('Select command to RESET')
            .addOptions(options);

        const backButton = new ButtonBuilder().setCustomId('setup_permissions').setLabel('Cancel').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ 
            embeds: [new EmbedBuilder().setTitle('🗑️ Delete Permission Config').setDescription('Select the command to remove all overrides (Reset to default).').setColor(0xE74C3C)], 
            components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] 
        });
        return;
    }

    if (interaction.isStringSelectMenu() && customId === 'select_delete_perm') {
        await safeDefer(interaction, true);
        
        await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, values[0]]);
        guildCache.flush(guildId); 
        
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_permissions').setLabel('Return to View').setStyle(ButtonStyle.Primary));
        
        await interaction.editReply({ embeds: [success(`Permissions for **/${values[0]}** have been reset to default.`)], components: [row] });
        return;
    }

    if (interaction.isStringSelectMenu() && customId.startsWith('select_command_perms')) {
        await safeDefer(interaction, true);
        const cmdName = values[0];
        
        const res = await db.query("SELECT role_id FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
        const currentRoles = res.rows.map(r => `<@&${r.role_id}>`).join(', ') || 'None';
        
        const menu = new RoleSelectMenuBuilder()
            .setCustomId(`perms_role_select_${cmdName}`)
            .setPlaceholder(`Allowed roles for /${cmdName}`)
            .setMinValues(0)
            .setMaxValues(25);
            
        const backButton = new ButtonBuilder().setCustomId('setup_perms_edit_select').setLabel('⬅️ Back to Commands').setStyle(ButtonStyle.Secondary);
        
        await interaction.editReply({ 
            embeds: [new EmbedBuilder().setTitle(`🔐 Permissions for /${cmdName}`).setDescription(`Current Allowed Roles: ${currentRoles}\n\n**Select NEW list of allowed roles.**\n(Leave empty to remove all overrides)`)], 
            components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] 
        });
        return;
    }

    if (interaction.isRoleSelectMenu() && customId.startsWith('perms_role_select_')) {
        await safeDefer(interaction, true);
        const cmdName = customId.replace('perms_role_select_', '');
        
        await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
        
        for (const rId of values) { 
            await db.query("INSERT INTO command_permissions (guildid, command_name, role_id) VALUES ($1, $2, $3)", [guildId, cmdName, rId]); 
        }
        
        guildCache.flush(guildId); 
        
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_permissions').setLabel('Return to Permissions View').setStyle(ButtonStyle.Primary));
        
        await interaction.editReply({ embeds: [success(`Permissions for **/${cmdName}** updated.`)], components: [row] });
        return;
    }
};
