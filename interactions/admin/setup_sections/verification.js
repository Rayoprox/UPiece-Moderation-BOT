const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType } = require('discord.js');
const db = require('../../../utils/db.js');
const { success, error } = require('../../../utils/embedFactory.js');
const { smartReply } = require('../../../utils/interactionHelpers.js');

async function loadConfig(guildId) {
    const configRes = await db.query('SELECT * FROM verification_config WHERE guildid = $1', [guildId]);
    return configRes.rows[0] || {
        enabled: false,
        channel_id: null,
        verified_role_id: null,
        unverified_role_id: null,
        dm_message: 'Welcome! Please verify your account to access the server.',
        require_captcha: true
    };
}

async function saveField(guildId, config, field, value) {
    const updated = { ...config, [field]: value };
    await db.query(`
        INSERT INTO verification_config (guildid, enabled, channel_id, verified_role_id, unverified_role_id, dm_message, require_captcha)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (guildid) DO UPDATE SET ${field} = $${Object.keys(updated).indexOf(field) + 2}
    `.replace(
        `$${Object.keys(updated).indexOf(field) + 2}`,
        `EXCLUDED.${field}`
    ), [guildId, updated.enabled, updated.channel_id, updated.verified_role_id, updated.unverified_role_id, updated.dm_message, updated.require_captcha]);
    return updated;
}

async function showVerificationMenu(interaction, config) {
    const embed = new EmbedBuilder()
        .setTitle('🔒 Verification System Configuration')
        .setDescription('Configure user verification to protect against bots and ban evaders.')
        .addFields(
            { name: 'Status', value: config.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: 'Warnings Channel', value: config.channel_id ? `<#${config.channel_id}>` : 'Not set', inline: true },
            { name: 'Require CAPTCHA', value: config.require_captcha ? '✅ Yes' : '❌ No', inline: true },
            { name: 'Verified Role', value: config.verified_role_id ? `<@&${config.verified_role_id}>` : 'Not set', inline: true },
            { name: 'Unverified Role', value: config.unverified_role_id ? `<@&${config.unverified_role_id}>` : 'Not set', inline: true },
            { name: '\u200b', value: '\u200b', inline: true },
            { name: 'DM Message', value: (config.dm_message || 'Not set').substring(0, 100), inline: false }
        )
        .setColor(config.enabled ? '#00ff00' : '#ff0000')
        .setFooter({ text: '💡 Tip: Use the web dashboard for advanced configuration' });

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('verification_toggle')
            .setLabel(config.enabled ? 'Disable' : 'Enable')
            .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
            .setEmoji(config.enabled ? '❌' : '✅'),
        new ButtonBuilder()
            .setCustomId('verification_channel_select')
            .setLabel('Set Warnings Channel')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📺'),
        new ButtonBuilder()
            .setCustomId('verification_captcha_toggle')
            .setLabel('Toggle CAPTCHA')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔐')
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('verification_verified_role')
            .setLabel('Set Verified Role')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('✅'),
        new ButtonBuilder()
            .setCustomId('verification_unverified_role')
            .setLabel('Set Unverified Role')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⏳'),
        new ButtonBuilder()
            .setCustomId('setup_home')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⬅️')
    );

    return await smartReply(interaction, { embeds: [embed], components: [row1, row2] });
}

module.exports = async function setupVerification(interaction) {
    const { customId, guild } = interaction;
    const config = await loadConfig(guild.id);

    // Main verification menu
    if (customId === 'setup_verification') {
        return await showVerificationMenu(interaction, config);
    }

    // Toggle verification system
    if (customId === 'verification_toggle') {
        const newState = !config.enabled;
        await db.query(`
            INSERT INTO verification_config (guildid, enabled, channel_id, verified_role_id, unverified_role_id, dm_message, require_captcha)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (guildid) DO UPDATE SET enabled = $2
        `, [guild.id, newState, config.channel_id, config.verified_role_id, config.unverified_role_id, config.dm_message, config.require_captcha]);

        config.enabled = newState;
        return await showVerificationMenu(interaction, config);
    }

    // Toggle CAPTCHA requirement
    if (customId === 'verification_captcha_toggle') {
        const newState = !config.require_captcha;
        await db.query(`
            INSERT INTO verification_config (guildid, enabled, channel_id, verified_role_id, unverified_role_id, dm_message, require_captcha)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (guildid) DO UPDATE SET require_captcha = $7
        `, [guild.id, config.enabled, config.channel_id, config.verified_role_id, config.unverified_role_id, config.dm_message, newState]);

        config.require_captcha = newState;
        return await showVerificationMenu(interaction, config);
    }

    // ── Channel selection (native Discord picker — searchable) ──
    if (customId === 'verification_channel_select') {
        const channelMenu = new ChannelSelectMenuBuilder()
            .setCustomId('verification_channel_selected')
            .setPlaceholder('Search and select a channel...')
            .addChannelTypes(ChannelType.GuildText);

        const row = new ActionRowBuilder().addComponents(channelMenu);
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_verification').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('⬅️')
        );

        return await smartReply(interaction, {
            embeds: [new EmbedBuilder().setTitle('📺 Select Warnings Channel').setDescription('Choose where suspicious user alerts will be sent.\nYou can **search** by typing the channel name.').setColor('#667eea')],
            components: [row, backRow]
        });
    }

    // Channel selected (native)
    if (customId === 'verification_channel_selected' && interaction.isChannelSelectMenu()) {
        const channelId = interaction.values[0];
        await db.query(`
            INSERT INTO verification_config (guildid, enabled, channel_id, verified_role_id, unverified_role_id, dm_message, require_captcha)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (guildid) DO UPDATE SET channel_id = $3
        `, [guild.id, config.enabled, channelId, config.verified_role_id, config.unverified_role_id, config.dm_message, config.require_captcha]);

        config.channel_id = channelId;
        return await showVerificationMenu(interaction, config);
    }

    // ── Verified role selection (native Discord picker — searchable) ──
    if (customId === 'verification_verified_role') {
        const roleMenu = new RoleSelectMenuBuilder()
            .setCustomId('verification_verified_role_selected')
            .setPlaceholder('Search and select a role...');

        const row = new ActionRowBuilder().addComponents(roleMenu);
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_verification').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('⬅️')
        );

        return await smartReply(interaction, {
            embeds: [new EmbedBuilder().setTitle('✅ Select Verified Role').setDescription('Role assigned after successful verification.\nYou can **search** by typing the role name.').setColor('#667eea')],
            components: [row, backRow]
        });
    }

    // Verified role selected (native)
    if (customId === 'verification_verified_role_selected' && interaction.isRoleSelectMenu()) {
        const roleId = interaction.values[0];
        await db.query(`
            INSERT INTO verification_config (guildid, enabled, channel_id, verified_role_id, unverified_role_id, dm_message, require_captcha)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (guildid) DO UPDATE SET verified_role_id = $4
        `, [guild.id, config.enabled, config.channel_id, roleId, config.unverified_role_id, config.dm_message, config.require_captcha]);

        config.verified_role_id = roleId;
        return await showVerificationMenu(interaction, config);
    }

    // ── Unverified role selection (native Discord picker — searchable) ──
    if (customId === 'verification_unverified_role') {
        const roleMenu = new RoleSelectMenuBuilder()
            .setCustomId('verification_unverified_role_selected')
            .setPlaceholder('Search and select a role...');

        const row = new ActionRowBuilder().addComponents(roleMenu);
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_verification').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('⬅️')
        );

        return await smartReply(interaction, {
            embeds: [new EmbedBuilder().setTitle('⏳ Select Unverified Role').setDescription('Role assigned to new members before verification.\nYou can **search** by typing the role name.').setColor('#667eea')],
            components: [row, backRow]
        });
    }

    // Unverified role selected (native)
    if (customId === 'verification_unverified_role_selected' && interaction.isRoleSelectMenu()) {
        const roleId = interaction.values[0];
        await db.query(`
            INSERT INTO verification_config (guildid, enabled, channel_id, verified_role_id, unverified_role_id, dm_message, require_captcha)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (guildid) DO UPDATE SET unverified_role_id = $5
        `, [guild.id, config.enabled, config.channel_id, config.verified_role_id, roleId, config.dm_message, config.require_captcha]);

        config.unverified_role_id = roleId;
        return await showVerificationMenu(interaction, config);
    }
};
