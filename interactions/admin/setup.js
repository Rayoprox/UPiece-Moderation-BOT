const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
const { emojis } = require('../../utils/config.js');
const { safeDefer } = require('../../utils/interactionHelpers.js');

module.exports = async (interaction) => {
    const { customId, guild, client, values } = interaction;
    const db = client.db;
    const guildId = guild.id;
    
    // Helper para regenerar el menú principal de setup
    const setupCommand = client.commands.get('setup');
    const generateSetupContent = setupCommand?.generateSetupContent;

    // --- NAVEGACIÓN PRINCIPAL ---
    if (customId === 'setup_channels') {
        if (!await safeDefer(interaction, true)) return;
        const modlog = new ChannelSelectMenuBuilder().setCustomId('select_modlog_channel').setPlaceholder('ModLog Channel').setChannelTypes([ChannelType.GuildText]);
        const appeal = new ChannelSelectMenuBuilder().setCustomId('select_banappeal_channel').setPlaceholder('Ban Appeal Channel').setChannelTypes([ChannelType.GuildText]);
        const cmdlog = new ChannelSelectMenuBuilder().setCustomId('select_cmdlog_channel').setPlaceholder('Cmd Log Channel').setChannelTypes([ChannelType.GuildText]);
        const antinuke = new ChannelSelectMenuBuilder().setCustomId('select_antinuke_channel').setPlaceholder('Anti-Nuke Log Channel').setChannelTypes([ChannelType.GuildText]);
        
        const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
        
        await interaction.editReply({
            embeds: [new EmbedBuilder().setTitle('📜 Logging Channels').setDescription('Select channels for logs.')],
            components: [
                new ActionRowBuilder().addComponents(modlog),
                new ActionRowBuilder().addComponents(appeal),
                new ActionRowBuilder().addComponents(cmdlog),
                new ActionRowBuilder().addComponents(antinuke),
                backButton
            ]
        });
        return;
    }

    if (customId === 'setup_staff_roles') {
        if (!await safeDefer(interaction, true)) return;
        const menu = new RoleSelectMenuBuilder().setCustomId('select_staff_roles').setPlaceholder('Select Staff Roles...').setMinValues(0).setMaxValues(25);
        const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({
            embeds: [new EmbedBuilder().setTitle('🛡️ Staff Roles').setDescription('Select roles that are considered Staff (immune to automod).')],
            components: [new ActionRowBuilder().addComponents(menu), backButton]
        });
        return;
    }

    if (customId === 'setup_permissions') {
        if (!await safeDefer(interaction, true)) return;
        const commands = client.commands.map(c => ({ label: `/${c.data.name}`, value: c.data.name })).slice(0, 25);
        const menu = new StringSelectMenuBuilder().setCustomId('select_command_perms').setPlaceholder('Select command...').addOptions(commands);
        const backButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));
        await interaction.editReply({
            embeds: [new EmbedBuilder().setTitle('🔐 Permissions').setDescription('Select a command to edit its permissions.')],
            components: [new ActionRowBuilder().addComponents(menu), backButton]
        });
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

    // --- ANTINUKE ---
    if (customId === 'setup_antinuke') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1", [guildId]);
        const isEnabled = res.rows[0]?.antinuke_enabled || false;
        const embed = new EmbedBuilder().setTitle('🛡️ Anti-Nuke System').setDescription(`Status: **${isEnabled ? '✅ ENABLED' : '❌ DISABLED'}**`).setColor(isEnabled ? 0x2ECC71 : 0xE74C3C);
        const toggleBtn = new ButtonBuilder().setCustomId('antinuke_toggle').setLabel(isEnabled ? 'Disable' : 'Enable').setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success);
        const backBtn = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(toggleBtn, backBtn)] });
        return;
    }

    if (customId === 'antinuke_toggle') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1", [guildId]);
        const newState = !(res.rows[0]?.antinuke_enabled || false);
        await db.query(`INSERT INTO guild_backups (guildid, antinuke_enabled) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET antinuke_enabled = $2`, [guildId, newState]);
        const embed = new EmbedBuilder().setTitle('🛡️ Anti-Nuke System').setDescription(`Status: **${newState ? '✅ ENABLED' : '❌ DISABLED'}**`).setColor(newState ? 0x2ECC71 : 0xE74C3C);
        const toggleBtn = new ButtonBuilder().setCustomId('antinuke_toggle').setLabel(newState ? 'Disable' : 'Enable').setStyle(newState ? ButtonStyle.Danger : ButtonStyle.Success);
        const backBtn = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(toggleBtn, backBtn)] });
        return;
    }

    // --- DELETE DATA ---
    if (customId === 'delete_all_data') {
        if (!await safeDefer(interaction, false, true)) return; 
        const confirmBtn = new ButtonBuilder().setCustomId('confirm_delete_data').setLabel('CONFIRM DELETION').setStyle(ButtonStyle.Danger);
        const cancelBtn = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Cancel').setStyle(ButtonStyle.Secondary);
        await interaction.editReply({ content: `⚠️ **DANGER ZONE** ⚠️\nDelete ALL DATA? Cannot be undone.`, components: [new ActionRowBuilder().addComponents(confirmBtn, cancelBtn)] });
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
        await interaction.editReply({ content: `✅ All data for this guild has been wiped from the database.`, components: [] });
        return;
    }

    // --- SELECT HANDLERS ---
    if (interaction.isChannelSelectMenu() && customId.endsWith('_channel')) {
            await safeDefer(interaction, true);
            const logType = customId.replace('select_', '').replace('_channel', '');
            await db.query(`INSERT INTO log_channels (guildid, log_type, channel_id) VALUES ($1, $2, $3) ON CONFLICT(guildid, log_type) DO UPDATE SET channel_id = $3`, [guildId, logType, values[0]]);
            if(generateSetupContent) {
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ embeds: [embed], components });
            } else await interaction.editReply('✅ Saved');
            return;
    }

    if (interaction.isRoleSelectMenu() && customId === 'select_staff_roles') {
            await safeDefer(interaction, true);
            await db.query(`INSERT INTO guild_settings (guildid, staff_roles) VALUES ($1, $2) ON CONFLICT(guildid) DO UPDATE SET staff_roles = $2`, [guildId, values.join(',')]);
            if(generateSetupContent) {
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ embeds: [embed], components });
            } else await interaction.editReply('✅ Saved');
            return;
    }

    if (interaction.isStringSelectMenu() && customId === 'select_command_perms') {
            await safeDefer(interaction, true);
            const cmdName = values[0];
            const menu = new RoleSelectMenuBuilder().setCustomId(`perms_role_select_${cmdName}`).setPlaceholder(`Select roles for /${cmdName}`).setMinValues(0).setMaxValues(10);
            const back = new ButtonBuilder().setCustomId('setup_back_to_main').setLabel('Back').setStyle(ButtonStyle.Secondary);
            await interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`Permissions: /${cmdName}`).setDescription('Select allowed roles.')], components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(back)] });
            return;
    }

    if (interaction.isRoleSelectMenu() && customId.startsWith('perms_role_select_')) {
            await safeDefer(interaction, true);
            const cmdName = customId.replace('perms_role_select_', '');
            await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
            for (const rId of values) {
                await db.query("INSERT INTO command_permissions (guildid, command_name, role_id) VALUES ($1, $2, $3)", [guildId, cmdName, rId]);
            }
            if(generateSetupContent) {
                const { embed, components } = await generateSetupContent(interaction, guildId);
                await interaction.editReply({ embeds: [embed], components });
            } else await interaction.editReply('✅ Saved');
            return;
    }
};