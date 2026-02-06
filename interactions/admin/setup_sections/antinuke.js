const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const db = require('../../../utils/db.js');
const { safeDefer } = require('../../../utils/interactionHelpers.js');
const guildCache = require('../../../utils/guildCache.js');

module.exports = async (interaction) => {
    const { customId, guild } = interaction;
    const guildId = guild.id;

    // Redirect to main configuration view directly to avoid an extra summary page
    if (customId === 'setup_antinuke') {
        interaction.customId = 'antinuke_config';
        return module.exports(interaction);
    }

    if (customId === 'antinuke_toggle') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT antinuke_enabled FROM guild_backups WHERE guildid = $1", [guildId]);
        const newState = !(res.rows[0]?.antinuke_enabled);
        await db.query(`INSERT INTO guild_backups (guildid, antinuke_enabled) VALUES ($1, $2) ON CONFLICT (guildid) DO UPDATE SET antinuke_enabled = $2`, [guildId, newState]);
        guildCache.flush(guildId);
        // After enabling, open configuration so admins can adjust defaults
        if (newState) {
            interaction.customId = 'antinuke_config';
            return module.exports(interaction);
        }
        interaction.customId = 'setup_antinuke';
        return module.exports(interaction);
    }

    if (customId === 'antinuke_config') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT antinuke_enabled, threshold_count, threshold_time, antinuke_ignore_supreme, antinuke_ignore_verified, antinuke_action FROM guild_backups WHERE guildid = $1", [guildId]);
        const settings = res.rows[0] || { antinuke_enabled: false, threshold_count: 10, threshold_time: 60, antinuke_ignore_supreme: true, antinuke_ignore_verified: true, antinuke_action: 'ban' };

        const embed = new EmbedBuilder()
            .setTitle('⚙️ Anti-Nuke Configuration')
            .setDescription('Anti-Nuke detects mass administrative actions and helps protect your server. Configure how aggressive the system is, what it should do when triggered, and exceptions.')
            .addFields(
                { name: 'Status', value: settings.antinuke_enabled ? '✅ ENABLED' : '❌ DISABLED', inline: true },
                { name: 'Trigger Threshold', value: `> ${settings.threshold_count} actions`, inline: true },
                { name: 'Window', value: `${settings.threshold_time}s`, inline: true },
                { name: 'Action', value: `${settings.antinuke_action}`.toUpperCase(), inline: true },
                { name: 'Ignore SUPREME IDs', value: settings.antinuke_ignore_supreme ? '✅ Yes' : '❌ No', inline: true },
                { name: 'Ignore Verified Bots', value: settings.antinuke_ignore_verified ? '✅ Yes' : '❌ No', inline: true }
            )
            .setColor(settings.antinuke_enabled ? 0xE67E22 : 0x7F8C8D)
            .setFooter({ text: 'Tip: Use custom values to fine-tune protection.' });

        // Action select
        const actionMenu = new StringSelectMenuBuilder()
            .setCustomId('antinuke_action_select')
            .setPlaceholder('Select action on trigger')
            .addOptions([
                { label: 'Ban & Restore', value: 'ban', description: 'Ban the executor and restore removed members/channels when possible' },
                { label: 'Restore Only', value: 'restore', description: 'Attempt to restore removed items without banning' },
                { label: 'Notify Only', value: 'notify', description: 'Only send alerts to staff, no automatic actions' }
            ]);

        // Threshold select
        const thresholdMenu = new StringSelectMenuBuilder()
            .setCustomId('antinuke_threshold_select')
            .setPlaceholder('Set trigger threshold (actions)')
            .addOptions([
                { label: '5 actions', value: 'threshold_5' },
                { label: '10 actions', value: 'threshold_10' },
                { label: '20 actions', value: 'threshold_20' },
                { label: 'Custom…', value: 'threshold_custom', description: 'Enter a custom number' }
            ]);

        // Window select
        const windowMenu = new StringSelectMenuBuilder()
            .setCustomId('antinuke_window_select')
            .setPlaceholder('Set time window')
            .addOptions([
                { label: '30 seconds', value: 'window_30' },
                { label: '60 seconds', value: 'window_60' },
                { label: '300 seconds (5m)', value: 'window_300' },
                { label: 'Custom…', value: 'window_custom', description: 'Enter a custom duration in seconds' }
            ]);

        const btnToggle = new ButtonBuilder().setCustomId('antinuke_toggle').setLabel(settings.antinuke_enabled ? 'Disable' : 'Enable').setStyle(settings.antinuke_enabled ? ButtonStyle.Danger : ButtonStyle.Success);
        const btnSupreme = new ButtonBuilder().setCustomId('antinuke_toggle_supreme').setLabel(settings.antinuke_ignore_supreme ? 'Ignoring SUPREME IDs' : 'Do Not Ignore SUPREME').setStyle(ButtonStyle.Secondary);
        const btnVerified = new ButtonBuilder().setCustomId('antinuke_toggle_verified').setLabel(settings.antinuke_ignore_verified ? 'Ignoring Verified Bots' : 'Do Not Ignore Verified').setStyle(ButtonStyle.Secondary);
        const btnBack = new ButtonBuilder().setCustomId('setup_menu_protection').setLabel('Back').setStyle(ButtonStyle.Secondary);

        const rowAction = new ActionRowBuilder().addComponents(actionMenu);
        const rowThreshold = new ActionRowBuilder().addComponents(thresholdMenu);
        const rowWindow = new ActionRowBuilder().addComponents(windowMenu);
        const rowFlags = new ActionRowBuilder().addComponents(btnToggle, btnSupreme, btnVerified, btnBack);

        await interaction.editReply({ embeds: [embed], components: [rowAction, rowThreshold, rowWindow, rowFlags] });
        return;
    }

    // Handle configuration interactions: selects, modals, and toggles
    const simpleActions = ['antinuke_toggle_supreme', 'antinuke_toggle_verified', 'antinuke_action_select', 'antinuke_threshold_select', 'antinuke_window_select', 'antinuke_custom_threshold_modal', 'antinuke_custom_window_modal'];
    if (simpleActions.includes(customId) || customId === 'antinuke_custom_threshold_modal' || customId === 'antinuke_custom_window_modal') {
        // If the user selected the 'Custom' option from a select, show a modal immediately (no defer before showModal)
        if (customId === 'antinuke_threshold_select' && interaction.values && interaction.values[0] === 'threshold_custom') {
            const modal = new ModalBuilder().setCustomId('antinuke_custom_threshold_modal').setTitle('Custom Threshold');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('threshold_value').setLabel('Trigger threshold (actions)').setStyle(TextInputStyle.Short).setRequired(true)
            ));
            await interaction.showModal(modal);
            return;
        }
        if (customId === 'antinuke_window_select' && interaction.values && interaction.values[0] === 'window_custom') {
            const modal = new ModalBuilder().setCustomId('antinuke_custom_window_modal').setTitle('Custom Window');
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('window_value').setLabel('Window in seconds').setStyle(TextInputStyle.Short).setRequired(true)
            ));
            await interaction.showModal(modal);
            return;
        }

        // Validate modal submissions before deferring (modal interactions may fail validation)
        if (customId === 'antinuke_custom_threshold_modal') {
            const txt = interaction.fields.getTextInputValue('threshold_value').trim();
            const num = parseInt(txt, 10);
            if (isNaN(num) || num < 1 || num > 1000) {
                return interaction.reply({ content: '❌ Threshold must be a number between 1 and 1000.', ephemeral: true });
            }
        }

        if (customId === 'antinuke_custom_window_modal') {
            const txt = interaction.fields.getTextInputValue('window_value').trim();
            const num = parseInt(txt, 10);
            if (isNaN(num) || num < 10 || num > 86400) {
                return interaction.reply({ content: '❌ Window must be between 10 and 86400 seconds.', ephemeral: true });
            }
        }

        if (!await safeDefer(interaction, true)) return;

        // Load current settings
        const res = await db.query("SELECT antinuke_ignore_supreme, antinuke_ignore_verified, threshold_count, threshold_time, antinuke_action FROM guild_backups WHERE guildid = $1", [guildId]);
        const settings = res.rows[0] || { antinuke_ignore_supreme: true, antinuke_ignore_verified: true, threshold_count: 10, threshold_time: 60, antinuke_action: 'ban' };

        // Toggle buttons
        if (customId === 'antinuke_toggle_supreme') settings.antinuke_ignore_supreme = !settings.antinuke_ignore_supreme;
        if (customId === 'antinuke_toggle_verified') settings.antinuke_ignore_verified = !settings.antinuke_ignore_verified;

        // Action select
        if (customId === 'antinuke_action_select') {
            const val = interaction.values && interaction.values[0];
            if (val) settings.antinuke_action = val;
        }

        // Threshold select
        if (customId === 'antinuke_threshold_select') {
            const val = interaction.values && interaction.values[0];
            if (val && val.startsWith('threshold_')) {
                const num = parseInt(val.split('_')[1], 10);
                if (!isNaN(num)) settings.threshold_count = num;
            }
        }

        // Window select
        if (customId === 'antinuke_window_select') {
            const val = interaction.values && interaction.values[0];
            if (val && val.startsWith('window_')) {
                const num = parseInt(val.split('_')[1], 10);
                if (!isNaN(num)) settings.threshold_time = num;
            }
        }

        // Modal submissions (validation already done above)
        if (customId === 'antinuke_custom_threshold_modal') {
            const txt = interaction.fields.getTextInputValue('threshold_value').trim();
            const num = parseInt(txt, 10);
            settings.threshold_count = num;
        }

        if (customId === 'antinuke_custom_window_modal') {
            const txt = interaction.fields.getTextInputValue('window_value').trim();
            const num = parseInt(txt, 10);
            settings.threshold_time = num;
        }

        // Persist settings
        await db.query(`INSERT INTO guild_backups (guildid, antinuke_ignore_supreme, antinuke_ignore_verified, threshold_count, threshold_time, antinuke_action) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (guildid) DO UPDATE SET antinuke_ignore_supreme = $2, antinuke_ignore_verified = $3, threshold_count = $4, threshold_time = $5, antinuke_action = $6`, [guildId, settings.antinuke_ignore_supreme, settings.antinuke_ignore_verified, settings.threshold_count, settings.threshold_time, settings.antinuke_action]);
        guildCache.flush(guildId);
        interaction.customId = 'antinuke_config';
        return module.exports(interaction);
    }
};