const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
const { safeDefer } = require('../../utils/interactionHelpers.js');
const { success, error } = require('../../utils/embedFactory.js');
const { STAFF_COMMANDS } = require('../../utils/config.js'); // Importamos la lista

module.exports = async (interaction) => {
    const { customId, guild, client, values } = interaction;
    const db = client.db;
    const guildId = guild.id;
    
    const setupCommand = client.commands.get('setup');
    const generateSetupContent = setupCommand?.generateSetupContent;

    // --- LOG CHANNELS ---
    if (customId === 'setup_channels') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT log_type, channel_id FROM log_channels WHERE guildid = $1", [guildId]);
        const channels = {};
        res.rows.forEach(r => channels[r.log_type] = r.channel_id);
        const formatCh = (id) => id ? `<#${id}>` : '`Not Configured`';

        const embed = new EmbedBuilder().setTitle('📜 Logging Channels Config').setDescription('Current configuration for log channels.').setColor(0x3498DB)
            .addFields({ name: '🛡️ Moderation Logs', value: formatCh(channels['modlog']), inline: true }, { name: '🔨 Ban Appeals', value: formatCh(channels['banappeal']), inline: true }, { name: '💻 Command Logs', value: formatCh(channels['cmdlog']), inline: true }, { name: '☢️ Anti-Nuke Logs', value: formatCh(channels['antinuke']), inline: true });
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_channels_edit').setLabel('Edit Channels').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
            new ButtonBuilder().setCustomId('setup_channels_delete').setLabel('Delete').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
            new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary)
        );
        await interaction.editReply({ embeds: [embed], components: [row] });
        return;
    }

    if (customId === 'setup_channels_edit') {
        if (!await safeDefer(interaction, true)) return;
        const modlog = new ChannelSelectMenuBuilder().setCustomId('select_modlog_channel').setPlaceholder('Set ModLog Channel').setChannelTypes([ChannelType.GuildText]);
        const appeal = new ChannelSelectMenuBuilder().setCustomId('select_banappeal_channel').setPlaceholder('Set Ban Appeal Channel').setChannelTypes([ChannelType.GuildText]);
        const cmdlog = new ChannelSelectMenuBuilder().setCustomId('select_cmdlog_channel').setPlaceholder('Set Cmd Log Channel').setChannelTypes([ChannelType.GuildText]);
        const antinuke = new ChannelSelectMenuBuilder().setCustomId('select_antinuke_channel').setPlaceholder('Set Anti-Nuke Log Channel').setChannelTypes([ChannelType.GuildText]);
        const backButton = new ButtonBuilder().setCustomId('setup_channels').setLabel('⬅️ Back to View').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✏️ Edit Logging Channels').setDescription('Select the channels below to update configuration.')], components: [new ActionRowBuilder().addComponents(modlog), new ActionRowBuilder().addComponents(appeal), new ActionRowBuilder().addComponents(cmdlog), new ActionRowBuilder().addComponents(antinuke), new ActionRowBuilder().addComponents(backButton)] });
        return;
    }

    if (customId === 'setup_channels_delete') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT log_type FROM log_channels WHERE guildid = $1", [guildId]);
        if (res.rows.length === 0) {
            return interaction.editReply({ embeds: [error("No channels configured to delete.")], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels').setLabel('Back').setStyle(ButtonStyle.Secondary))]});
        }
        const options = res.rows.map(r => ({ label: `Delete ${r.log_type.toUpperCase()}`, value: r.log_type, emoji: '🗑️' }));
        const menu = new StringSelectMenuBuilder().setCustomId('select_delete_channel').setPlaceholder('Select channel to REMOVE config').addOptions(options);
        const backButton = new ButtonBuilder().setCustomId('setup_channels').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🗑️ Delete Channel Config').setDescription('Select the log type to remove from database.').setColor(0xE74C3C)], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
        return;
    }

    if (interaction.isStringSelectMenu() && customId === 'select_delete_channel') {
        await safeDefer(interaction, true);
        const logType = values[0];
        await db.query("DELETE FROM log_channels WHERE guildid = $1 AND log_type = $2", [guildId, logType]);
        const successEmbed = success(`Configuration for **${logType}** deleted.`);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels').setLabel('Return to View').setStyle(ButtonStyle.Primary));
        await interaction.editReply({ embeds: [successEmbed], components: [row] });
        return;
    }

    if (interaction.isChannelSelectMenu() && customId.endsWith('_channel')) {
        await safeDefer(interaction, true);
        const logType = customId.replace('select_', '').replace('_channel', '');
        await db.query(`INSERT INTO log_channels (guildid, log_type, channel_id) VALUES ($1, $2, $3) ON CONFLICT(guildid, log_type) DO UPDATE SET channel_id = $3`, [guildId, logType, values[0]]);
        const successEmbed = success(`Channel for **${logType}** updated to <#${values[0]}>`);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_channels').setLabel('Return to Channels View').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('setup_channels_edit').setLabel('Keep Editing').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({ embeds: [successEmbed], components: [row] });
        return;
    }

    // --- STAFF ROLES ---
    if (customId === 'setup_staff_roles') {
        if (!await safeDefer(interaction, true)) return;
        
        const res = await db.query("SELECT staff_roles FROM guild_settings WHERE guildid = $1", [guildId]);
        const rawRoles = res.rows[0]?.staff_roles || '';
        const roleIds = rawRoles ? rawRoles.split(',') : [];
        const description = roleIds.length > 0 ? roleIds.map(id => `• <@&${id}>`).join('\n') : '`No Staff Roles Configured`';
        
        // LISTA DE COMANDOS VISUAL
        const allowedCmds = STAFF_COMMANDS.map(c => `\`${c}\``).join(', ');

        const embed = new EmbedBuilder()
            .setTitle('🛡️ Staff Roles Config')
            .setDescription(`Roles configured here will bypass Automod and have access to **Staff Commands**.\n\n**Current Staff Roles:**\n${description}`)
            .addFields({
                name: '✅ Granted Commands (Default)',
                value: allowedCmds || 'None defined in config.'
            })
            .setColor(0xF1C40F);
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_staff_edit').setLabel('Edit Roles').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
            new ButtonBuilder().setCustomId('setup_staff_delete_all').setLabel('Delete All').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
            new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary)
        );
        await interaction.editReply({ embeds: [embed], components: [row] });
        return;
    }

    if (customId === 'setup_staff_edit') {
        if (!await safeDefer(interaction, true)) return;
        const menu = new RoleSelectMenuBuilder().setCustomId('select_staff_roles').setPlaceholder('Add or Remove Staff Roles...').setMinValues(0).setMaxValues(25);
        const backButton = new ButtonBuilder().setCustomId('setup_staff_roles').setLabel('⬅️ Back to View').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✏️ Edit Staff Roles').setDescription('Select ALL roles that should be Staff. Unselecting a role removes it.')], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
        return;
    }

    if (customId === 'setup_staff_delete_all') {
        if (!await safeDefer(interaction, true)) return;
        await db.query("UPDATE guild_settings SET staff_roles = NULL WHERE guildid = $1", [guildId]);
        const successEmbed = success(`All Staff Roles have been removed.`);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_staff_roles').setLabel('Return to View').setStyle(ButtonStyle.Primary));
        await interaction.editReply({ embeds: [successEmbed], components: [row] });
        return;
    }

    if (interaction.isRoleSelectMenu() && customId === 'select_staff_roles') {
        await safeDefer(interaction, true);
        const rolesStr = values.join(',');
        await db.query(`INSERT INTO guild_settings (guildid, staff_roles) VALUES ($1, $2) ON CONFLICT(guildid) DO UPDATE SET staff_roles = $2`, [guildId, rolesStr]);
        const successEmbed = success(`Staff Roles updated successfully. (${values.length} roles active)`);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_staff_roles').setLabel('Return to Staff View').setStyle(ButtonStyle.Primary));
        await interaction.editReply({ embeds: [successEmbed], components: [row] });
        return;
    }

    
    if (customId === 'setup_permissions') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT command_name, role_id FROM command_permissions WHERE guildid = $1 ORDER BY command_name", [guildId]);
        const perms = {};
        res.rows.forEach(r => { if (!perms[r.command_name]) perms[r.command_name] = []; perms[r.command_name].push(r.role_id); });
        let description = '';
        if (Object.keys(perms).length === 0) { description = '`No specific command permissions configured.`'; } else { for (const [cmd, roles] of Object.entries(perms)) { const roleMentions = roles.map(r => `<@&${r}>`).join(', '); description += `**/${cmd}**: ${roleMentions}\n`; } }
        const embed = new EmbedBuilder().setTitle('🔐 Command Permissions Config').setDescription(`Specific role overrides for commands (Bypass defaults & Lockdown).\n\n${description}`).setColor(0xE74C3C);
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_perms_edit_select').setLabel('Add/Edit Override').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
            new ButtonBuilder().setCustomId('setup_perms_delete').setLabel('Delete').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
            new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary)
        );
        await interaction.editReply({ embeds: [embed], components: [row] });
        return;
    }

    if (customId === 'setup_perms_edit_select') {
        if (!await safeDefer(interaction, true)) return;
        const commands = client.commands.filter(c => c.data.name !== 'setup').map(c => ({ label: `/${c.data.name}`, value: c.data.name })).slice(0, 25);
        const menu = new StringSelectMenuBuilder().setCustomId('select_command_perms').setPlaceholder('Select command to edit...').addOptions(commands);
        const backButton = new ButtonBuilder().setCustomId('setup_permissions').setLabel('⬅️ Back to View').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('✏️ Select Command').setDescription('Which command do you want to modify permissions for?')], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
        return;
    }

    if (customId === 'setup_perms_delete') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT DISTINCT command_name FROM command_permissions WHERE guildid = $1", [guildId]);
        if (res.rows.length === 0) {
            return interaction.editReply({ embeds: [error("No custom permissions configured to delete.")], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_permissions').setLabel('Back').setStyle(ButtonStyle.Secondary))]});
        }
        const options = res.rows.map(r => ({ label: `Reset /${r.command_name}`, value: r.command_name, emoji: '🗑️' })).slice(0, 25);
        const menu = new StringSelectMenuBuilder().setCustomId('select_delete_perm').setPlaceholder('Select command to RESET').addOptions(options);
        const backButton = new ButtonBuilder().setCustomId('setup_permissions').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('🗑️ Delete Permission Config').setDescription('Select the command to remove all overrides (Reset to default).').setColor(0xE74C3C)], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
        return;
    }

    if (interaction.isStringSelectMenu() && customId === 'select_delete_perm') {
        await safeDefer(interaction, true);
        const cmdName = values[0];
        await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
        const successEmbed = success(`Permissions for **/${cmdName}** have been reset to default.`);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_permissions').setLabel('Return to View').setStyle(ButtonStyle.Primary));
        await interaction.editReply({ embeds: [successEmbed], components: [row] });
        return;
    }

    if (interaction.isStringSelectMenu() && customId === 'select_command_perms') {
        await safeDefer(interaction, true);
        const cmdName = values[0];
        const res = await db.query("SELECT role_id FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
        const currentRoles = res.rows.map(r => `<@&${r.role_id}>`).join(', ') || 'None';
        const menu = new RoleSelectMenuBuilder().setCustomId(`perms_role_select_${cmdName}`).setPlaceholder(`Allowed roles for /${cmdName}`).setMinValues(0).setMaxValues(25);
        const backButton = new ButtonBuilder().setCustomId('setup_perms_edit_select').setLabel('⬅️ Back to Commands').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`🔐 Permissions for /${cmdName}`).setDescription(`Current Allowed Roles: ${currentRoles}\n\n**Select NEW list of allowed roles.**\n(Leave empty to remove all overrides)`)], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] });
        return;
    }

    if (interaction.isRoleSelectMenu() && customId.startsWith('perms_role_select_')) {
        await safeDefer(interaction, true);
        const cmdName = customId.replace('perms_role_select_', '');
        await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
        for (const rId of values) { await db.query("INSERT INTO command_permissions (guildid, command_name, role_id) VALUES ($1, $2, $3)", [guildId, cmdName, rId]); }
        const successEmbed = success(`Permissions for **/${cmdName}** updated.`);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_permissions').setLabel('Return to Permissions View').setStyle(ButtonStyle.Primary));
        await interaction.editReply({ embeds: [successEmbed], components: [row] });
        return;
    }

    if (customId === 'setup_back_to_main' && generateSetupContent) {
        if (!await safeDefer(interaction, true)) return;
        const { embed, components } = await generateSetupContent(interaction, guildId);
        await interaction.editReply({ embeds: [embed], components });
        return;
    }

    if (customId === 'cancel_setup') {
        await interaction.deferUpdate(); 
        await interaction.deleteReply().catch(() => {});
        return;
    }

    if (customId === 'setup_antinuke') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1", [guildId]);
        const isEnabled = res.rows[0]?.antinuke_enabled || false;
        const embed = new EmbedBuilder().setTitle('🛡️ Anti-Nuke System').setDescription(`The Anti-Nuke system automatically backups the server state (Roles, Channels) daily and allows restoration.\n\n**Status:** ${isEnabled ? '✅ ENABLED' : '❌ DISABLED'}`).setColor(isEnabled ? 0x2ECC71 : 0xE74C3C);
        const toggleBtn = new ButtonBuilder().setCustomId('antinuke_toggle').setLabel(isEnabled ? 'Disable System' : 'Enable System').setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success);
        const backBtn = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(toggleBtn, backBtn)] });
        return;
    }

    if (customId === 'antinuke_toggle') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1", [guildId]);
        const newState = !(res.rows[0]?.antinuke_enabled || false);
        await db.query(`INSERT INTO guild_backups (guildid, antinuke_enabled) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET antinuke_enabled = $2`, [guildId, newState]);
        const embed = new EmbedBuilder().setTitle('🛡️ Anti-Nuke System').setDescription(`**Status:** ${newState ? '✅ ENABLED' : '❌ DISABLED'}`).setColor(newState ? 0x2ECC71 : 0xE74C3C);
        const toggleBtn = new ButtonBuilder().setCustomId('antinuke_toggle').setLabel(newState ? 'Disable System' : 'Enable System').setStyle(newState ? ButtonStyle.Danger : ButtonStyle.Success);
        const backBtn = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(toggleBtn, backBtn)] });
        return;
    }

    if (customId === 'delete_all_data') {
        if (!await safeDefer(interaction, false, true)) return; 
        const confirmBtn = new ButtonBuilder().setCustomId('confirm_delete_data').setLabel('CONFIRM DELETION').setStyle(ButtonStyle.Danger);
        const cancelBtn = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [error('⚠️ **DANGER ZONE** ⚠️\nThis will delete ALL configuration, logs, rules and appeals for this server.\nThis action cannot be undone.')], components: [new ActionRowBuilder().addComponents(confirmBtn, cancelBtn)] });
        return;
    }

    if (customId === 'confirm_delete_data') {
        if (!await safeDefer(interaction, true)) return;
        await db.query("DELETE FROM automod_rules WHERE guildid = $1", [guildId]);
        await db.query("DELETE FROM modlogs WHERE guildid = $1", [guildId]);
        await db.query("DELETE FROM command_permissions WHERE guildid = $1", [guildId]);
        await db.query("DELETE FROM log_channels WHERE guildid = $1", [guildId]);
        await db.query("DELETE FROM guild_settings WHERE guildid = $1", [guildId]);
        await db.query("DELETE FROM appeal_blacklist WHERE guildid = $1", [guildId]);
        await db.query("DELETE FROM pending_appeals WHERE guildid = $1", [guildId]);
        await db.query("DELETE FROM guild_backups WHERE guildid = $1", [guildId]); 
        await interaction.editReply({ embeds: [success('All data for this guild has been wiped from the database.')], components: [] });
        return;
    }
};