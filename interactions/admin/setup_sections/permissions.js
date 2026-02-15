const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, RoleSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');
const db = require('../../../utils/db.js');
const { success, error } = require('../../../utils/embedFactory.js');
const { safeDefer } = require('../../../utils/interactionHelpers.js');
const guildCache = require('../../../utils/guildCache.js');
const { emojis } = require('../../../utils/config.js');

module.exports = async (interaction) => {
    const { customId, guild, client, values } = interaction;
    const guildId = guild.id;

    // Main permissions view
    if (customId === 'setup_permissions' || customId === 'setup_permissions_menu') {
        if (!await safeDefer(interaction, true)) return;
        
        const res = await db.query("SELECT command_name, role_id FROM command_permissions WHERE guildid = $1 ORDER BY command_name", [guildId]);
        const settingsRes = await db.query("SELECT command_name, enabled, ignored_channels FROM command_settings WHERE guildid = $1", [guildId]);
        
        const perms = {};
        res.rows.forEach(r => { 
            if (!perms[r.command_name]) perms[r.command_name] = []; 
            perms[r.command_name].push(r.role_id); 
        });

        const settings = {};
        settingsRes.rows.forEach(r => {
            let ignoredChannels = [];
            if (r.ignored_channels) {
                if (Array.isArray(r.ignored_channels)) {
                    ignoredChannels = r.ignored_channels.filter(Boolean);
                } else if (typeof r.ignored_channels === 'string') {
                    ignoredChannels = r.ignored_channels.split(',').filter(Boolean);
                }
            }
            settings[r.command_name] = { enabled: r.enabled !== false, ignoredChannels };
        });

        const allCommands = client.commands
            .filter(c => c.data.name !== 'setup' && c.category !== 'developer')
            .map(c => c.data.name)
            .sort((a, b) => a.localeCompare(b));

        let description;
        if (allCommands.length === 0) {
            description = '`No commands available.`';
        } else {
            const lines = allCommands.map(cmd => {
                const roles = perms[cmd] || [];
                const rolesLabel = roles.length > 0 ? roles.map(r => `<@&${r}>`).join(', ') : 'All';
                const cfg = settings[cmd] || { enabled: true, ignoredChannels: [] };
                const status = cfg.enabled ? `${emojis.success} ON` : `${emojis.error} OFF`;
                const ignored = cfg.ignoredChannels.length > 0 ? `${cfg.ignoredChannels.length} ignored` : 'None';
                return `**/${cmd}**  ${status}\n• Roles: ${rolesLabel}\n• Ignored: ${ignored}`;
            });

            let combined = '';
            let cutoffIndex = lines.length;
            for (let i = 0; i < lines.length; i += 1) {
                const next = combined.length ? `${combined}\n${lines[i]}` : lines[i];
                if (next.length > 3900) { cutoffIndex = i; break; }
                combined = next;
            }

            if (cutoffIndex < lines.length) {
                const remaining = lines.length - cutoffIndex;
                combined = `${combined}\n…and ${remaining} more`;
            }

            description = combined;
        }
        
        const embed = new EmbedBuilder()
            .setTitle('🔐 Command Permissions Config')
            .setDescription(`Specific role overrides for commands (Bypass defaults & Lockdown).\n\n${description}`)
            .setColor(0xE74C3C);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_perms_select_command').setLabel('Configure Command').setStyle(ButtonStyle.Primary).setEmoji('⚙️'),
            new ButtonBuilder().setCustomId('setup_home').setLabel('Back').setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
        return;
    }

    // Select command to configure
    if (customId === 'setup_perms_select_command') {
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
                .setCustomId(`select_perm_command_${index}`)
                .setPlaceholder(`Select command to configure... (Page ${index + 1})`)
                .addOptions(chunk);
            components.push(new ActionRowBuilder().addComponents(menu));
        });
        
        const backButton = new ButtonBuilder().setCustomId('setup_permissions').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary);
        components.push(new ActionRowBuilder().addComponents(backButton));

        await interaction.editReply({ 
            embeds: [new EmbedBuilder().setTitle('✏️ Select Command to Configure').setDescription('Which command do you want to configure?\nThe command list is split into multiple pages if it exceeds 25.')], 
            components: components
        });
        return;
    }

    // Handle command selection from multi-page menu
    if (interaction.isStringSelectMenu() && customId.startsWith('select_perm_command_')) {
        await safeDefer(interaction, true);
        const cmdName = values[0];
        return await showCommandConfig(interaction, guild, client, guildId, cmdName);
    }

    // Show command configuration panel
    if (customId.startsWith('setup_perm_config_')) {
        const cmdName = customId.replace('setup_perm_config_', '');
        return await showCommandConfig(interaction, guild, client, guildId, cmdName);
    }

    // Open ignored channels editor
    if (customId.startsWith('setup_perm_ignored_')) {
        const cmdName = customId.replace('setup_perm_ignored_', '');
        if (!await safeDefer(interaction, true)) return;

        const res = await db.query('SELECT ignored_channels FROM command_settings WHERE guildid = $1 AND command_name = $2', [guildId, cmdName]);
        let ignoredChannels = [];
        const ignoredChannelsStr = res.rows[0]?.ignored_channels || '';
        if (Array.isArray(ignoredChannelsStr)) {
            ignoredChannels = ignoredChannelsStr.filter(Boolean);
        } else if (typeof ignoredChannelsStr === 'string') {
            ignoredChannels = ignoredChannelsStr.split(',').filter(Boolean);
        }

        const embed = new EmbedBuilder()
            .setTitle(`📍 Ignored Channels for /${cmdName}`)
            .setDescription(ignoredChannels.length > 0 
                ? `Currently ignored:\n${ignoredChannels.map(chId => `<#${chId}>`).join(', ')}`
                : 'No channels ignored for this command.')
            .setColor(0x3498DB);

        const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId(`perm_select_ignored_channels_${cmdName}`)
            .setPlaceholder('Select channels to ignore...')
            .addChannelTypes(ChannelType.GuildText)
            .setMinValues(0)
            .setMaxValues(25);

        const backButton = new ButtonBuilder().setCustomId(`setup_perm_config_${cmdName}`).setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ 
            embeds: [embed], 
            components: [new ActionRowBuilder().addComponents(channelSelect), new ActionRowBuilder().addComponents(backButton)] 
        });
        return;
    }

    // Save ignored channels
    if (interaction.isChannelSelectMenu() && customId.startsWith('perm_select_ignored_channels_')) {
        await safeDefer(interaction, true);
        const cmdName = customId.replace('perm_select_ignored_channels_', '');
        const selectedChannels = values.join(',');

        await db.query(
            'INSERT INTO command_settings (guildid, command_name, enabled, ignored_channels) VALUES ($1, $2, TRUE, $3) ON CONFLICT (guildid, command_name) DO UPDATE SET ignored_channels = EXCLUDED.ignored_channels',
            [guildId, cmdName, selectedChannels]
        );

        guildCache.flush(guildId);
        return await showCommandConfig(interaction, guild, client, guildId, cmdName);
    }

    // Open allowed roles editor
    if (customId.startsWith('setup_perm_roles_')) {
        const cmdName = customId.replace('setup_perm_roles_', '');
        if (!await safeDefer(interaction, true)) return;

        const res = await db.query("SELECT role_id FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
        const allowedRoles = res.rows.map(r => r.role_id);
        const currentRoles = allowedRoles.length > 0 ? allowedRoles.map(r => `<@&${r}>`).join(', ') : 'None';

        const embed = new EmbedBuilder()
            .setTitle(`🔐 Allowed Roles for /${cmdName}`)
            .setDescription(`Current Allowed Roles: ${currentRoles}\n\n**Select the NEW list of allowed roles.**\n(Leave empty to remove all overrides)`)
            .setColor(0x3498DB);

        const menu = new RoleSelectMenuBuilder()
            .setCustomId(`perm_role_select_${cmdName}`)
            .setPlaceholder(`Allowed roles for /${cmdName}`)
            .setMinValues(0)
            .setMaxValues(25);

        const backButton = new ButtonBuilder().setCustomId(`setup_perm_config_${cmdName}`).setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ 
            embeds: [embed], 
            components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(backButton)] 
        });
        return;
    }

    // Save allowed roles
    if (interaction.isRoleSelectMenu() && customId.startsWith('perm_role_select_')) {
        await safeDefer(interaction, true);
        const cmdName = customId.replace('perm_role_select_', '');
        
        // Delete all existing roles for this command
        await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
        
        // Insert new roles
        for (const rId of values) {
            await db.query("INSERT INTO command_permissions (guildid, command_name, role_id) VALUES ($1, $2, $3)", [guildId, cmdName, rId]);
        }

        guildCache.flush(guildId);
        return await showCommandConfig(interaction, guild, client, guildId, cmdName);
    }

    // Toggle command enabled/disabled
    if (customId.startsWith('setup_perm_toggle_')) {
        await safeDefer(interaction, true);
        const cmdName = customId.replace('setup_perm_toggle_', '');

        const res = await db.query('SELECT enabled FROM command_settings WHERE guildid = $1 AND command_name = $2', [guildId, cmdName]);
        const currentEnabled = res.rows[0]?.enabled !== false;
        const newEnabled = !currentEnabled;

        await db.query(
            'INSERT INTO command_settings (guildid, command_name, enabled) VALUES ($1, $2, $3) ON CONFLICT (guildid, command_name) DO UPDATE SET enabled = EXCLUDED.enabled',
            [guildId, cmdName, newEnabled]
        );

        guildCache.flush(guildId);
        return await showCommandConfig(interaction, guild, client, guildId, cmdName);
    }

    // Delete command configuration
    if (customId.startsWith('setup_perm_delete_')) {
        await safeDefer(interaction, true);
        const cmdName = customId.replace('setup_perm_delete_', '');

        await db.query("DELETE FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
        await db.query("DELETE FROM command_settings WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);

        guildCache.flush(guildId);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_permissions').setLabel('Return to Permissions View').setStyle(ButtonStyle.Primary)
        );

        await interaction.editReply({ 
            embeds: [success(`Configuration for **/${cmdName}** has been deleted.`)], 
            components: [row] 
        });
        return;
    }
};

async function showCommandConfig(interaction, guild, client, guildId, cmdName) {
    const settingsRes = await db.query('SELECT enabled, ignored_channels FROM command_settings WHERE guildid = $1 AND command_name = $2', [guildId, cmdName]);
    const settings = settingsRes.rows[0] || { enabled: true, ignored_channels: null };

    const rolesRes = await db.query("SELECT role_id FROM command_permissions WHERE guildid = $1 AND command_name = $2", [guildId, cmdName]);
    const allowedRoles = rolesRes.rows.map(r => r.role_id);

    let ignoredChannels = [];
    const ignoredChannelsRaw = settings.ignored_channels;
    if (Array.isArray(ignoredChannelsRaw)) {
        ignoredChannels = ignoredChannelsRaw.filter(Boolean);
    } else if (typeof ignoredChannelsRaw === 'string') {
        ignoredChannels = ignoredChannelsRaw.split(',').filter(Boolean);
    }

    const embed = new EmbedBuilder()
        .setTitle(`⚙️ Configure: /${cmdName}`)
        .setColor(0x9B59B6)
        .addFields(
            {
                name: '🔐 Allowed Roles',
                value: allowedRoles.length > 0 ? allowedRoles.map(r => `<@&${r}>`).join(', ') : '`None - Allows all`',
                inline: false
            },
            {
                name: '📍 Ignored Channels',
                value: ignoredChannels.length > 0 ? ignoredChannels.map(ch => `<#${ch}>`).join(', ') : '`None`',
                inline: false
            },
            {
                name: '✅ Status',
                value: settings.enabled === false ? `${emojis.error} **DISABLED**` : `${emojis.success} **ENABLED**`,
                inline: true
            }
        );

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`setup_perm_roles_${cmdName}`)
            .setLabel('Allowed Roles')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔐'),
        new ButtonBuilder()
            .setCustomId(`setup_perm_ignored_${cmdName}`)
            .setLabel('Ignored Channels')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📍')
    );

        const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`setup_perm_toggle_${cmdName}`)
            .setLabel(settings.enabled === false ? 'Enable' : 'Disable')
            .setStyle(settings.enabled === false ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji(settings.enabled === false ? '🟢' : '🔴'),
        new ButtonBuilder()
            .setCustomId(`setup_perm_delete_${cmdName}`)
            .setLabel('Delete Config')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️'),
        new ButtonBuilder()
                .setCustomId('setup_perms_select_command')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⬅️')
    );

    if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed], components: [row1, row2] });
    } else {
        await interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
    }
}
