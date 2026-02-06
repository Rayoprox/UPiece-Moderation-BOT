const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../../utils/db.js');
const { safeDefer } = require('../../../utils/interactionHelpers.js');
const guildCache = require('../../../utils/guildCache.js');

module.exports = async (interaction) => {
    const { customId, guild } = interaction;
    const guildId = guild.id;

    if (customId === 'setup_antinuke') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT antinuke_enabled, threshold_count, threshold_time, antinuke_ignore_supreme, antinuke_ignore_verified, antinuke_action FROM guild_backups WHERE guildid = $1", [guildId]);
        const settings = res.rows[0] || { antinuke_enabled: false, threshold_count: 10, threshold_time: 60, antinuke_ignore_supreme: true, antinuke_ignore_verified: true, antinuke_action: 'ban' };
        const status = settings.antinuke_enabled ? '✅ ENABLED' : '❌ DISABLED';

        const embed = new EmbedBuilder()
            .setTitle('Anti-Nuke')
            .addFields(
                { name: 'Status', value: status, inline: true },
                { name: 'Threshold', value: `${settings.threshold_count} / ${settings.threshold_time}s`, inline: true },
                { name: 'Action', value: settings.antinuke_action, inline: true },
                { name: 'Ignore SUPREME IDs', value: settings.antinuke_ignore_supreme ? 'Yes' : 'No', inline: true },
                { name: 'Ignore Verified Bots', value: settings.antinuke_ignore_verified ? 'Yes' : 'No', inline: true }
            )
            .setColor(settings.antinuke_enabled ? 0x2ECC71 : 0xE74C3C)
            .setFooter({ text: 'Anti-Nuke' })
            .setTimestamp();
        const toggle = new ButtonBuilder().setCustomId('antinuke_toggle').setLabel(settings.antinuke_enabled ? 'Disable' : 'Enable').setStyle(settings.antinuke_enabled ? ButtonStyle.Danger : ButtonStyle.Success);
        const configure = new ButtonBuilder().setCustomId('antinuke_config').setLabel('Configure').setStyle(ButtonStyle.Primary);
        const back = new ButtonBuilder().setCustomId('setup_menu_protection').setLabel('Back').setStyle(ButtonStyle.Secondary);

        await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(toggle, configure, back)] });
        return;
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
            .setDescription('Customize Anti-Nuke behavior for this server.')
            .addFields(
                { name: 'Enabled', value: settings.antinuke_enabled ? '✅' : '❌', inline: true },
                { name: 'Threshold', value: `${settings.threshold_count} / ${settings.threshold_time}s`, inline: true },
                { name: 'Ignore SUPREME IDs', value: settings.antinuke_ignore_supreme ? '✅' : '❌', inline: true },
                { name: 'Ignore Verified Bots', value: settings.antinuke_ignore_verified ? '✅' : '❌', inline: true },
                { name: 'Action', value: `${settings.antinuke_action}`, inline: true }
            )
            .setColor('#F39C12');

        const btnSupreme = new ButtonBuilder().setCustomId('antinuke_toggle_supreme').setLabel(settings.antinuke_ignore_supreme ? 'Do Not Ignore SUPREME' : 'Ignore SUPREME').setStyle(ButtonStyle.Secondary);
        const btnVerified = new ButtonBuilder().setCustomId('antinuke_toggle_verified').setLabel(settings.antinuke_ignore_verified ? 'Do Not Ignore Verified' : 'Ignore Verified').setStyle(ButtonStyle.Secondary);
        const btnInc = new ButtonBuilder().setCustomId('antinuke_inc_threshold').setLabel('+ Threshold').setStyle(ButtonStyle.Primary);
        const btnDec = new ButtonBuilder().setCustomId('antinuke_dec_threshold').setLabel('- Threshold').setStyle(ButtonStyle.Primary);
        const btnBack = new ButtonBuilder().setCustomId('setup_antinuke').setLabel('Back').setStyle(ButtonStyle.Secondary);

        const row1 = new ActionRowBuilder().addComponents(btnSupreme, btnVerified, btnBack);
        const row2 = new ActionRowBuilder().addComponents(btnInc, btnDec);
        await interaction.editReply({ embeds: [embed], components: [row1, row2] });
        return;
    }

    if (customId === 'antinuke_toggle_supreme' || customId === 'antinuke_toggle_verified' || customId === 'antinuke_inc_threshold' || customId === 'antinuke_dec_threshold') {
        if (!await safeDefer(interaction, true)) return;
        const res = await db.query("SELECT antinuke_ignore_supreme, antinuke_ignore_verified, threshold_count FROM guild_backups WHERE guildid = $1", [guildId]);
        const settings = res.rows[0] || { antinuke_ignore_supreme: true, antinuke_ignore_verified: true, threshold_count: 10 };
        if (customId === 'antinuke_toggle_supreme') settings.antinuke_ignore_supreme = !settings.antinuke_ignore_supreme;
        if (customId === 'antinuke_toggle_verified') settings.antinuke_ignore_verified = !settings.antinuke_ignore_verified;
        if (customId === 'antinuke_inc_threshold') settings.threshold_count = (settings.threshold_count || 10) + 1;
        if (customId === 'antinuke_dec_threshold') settings.threshold_count = Math.max(1, (settings.threshold_count || 10) - 1);

        await db.query(`INSERT INTO guild_backups (guildid, antinuke_ignore_supreme, antinuke_ignore_verified, threshold_count) VALUES ($1, $2, $3, $4) ON CONFLICT (guildid) DO UPDATE SET antinuke_ignore_supreme = $2, antinuke_ignore_verified = $3, threshold_count = $4`, [guildId, settings.antinuke_ignore_supreme, settings.antinuke_ignore_verified, settings.threshold_count]);
        guildCache.flush(guildId);
        interaction.customId = 'antinuke_config';
        return module.exports(interaction);
    }
};