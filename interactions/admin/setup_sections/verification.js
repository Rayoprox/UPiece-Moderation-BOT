const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ChannelType } = require('discord.js');
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
    const { customId, guild, values } = interaction;
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

    // Channel selection menu
    if (customId === 'verification_channel_select') {
        const textChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
        
        if (textChannels.size === 0) {
            return await smartReply(interaction, { embeds: [error('No text channels found!')] });
        }

        const options = textChannels.map(channel => 
            new StringSelectMenuOptionBuilder()
                .setLabel(`#${channel.name}`)
                .setValue(channel.id)
                .setDescription('Set as warnings channel')
                .setDefault(config.channel_id === channel.id)
        ).slice(0, 25);

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('verification_channel_selected')
            .setPlaceholder('Select a channel for warnings')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_verification').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('⬅️')
        );

        return await smartReply(interaction, { 
            embeds: [new EmbedBuilder().setTitle('Select Warnings Channel').setDescription('Choose where suspicious user alerts will be sent.').setColor('#667eea')],
            components: [row, backRow]
        });
    }

    // Channel selected
    if (customId === 'verification_channel_selected') {
        const channelId = values[0];
        
        await db.query(`
            INSERT INTO verification_config (guildid, enabled, channel_id, verified_role_id, unverified_role_id, dm_message, require_captcha)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (guildid) DO UPDATE SET channel_id = $3
        `, [guild.id, config.enabled, channelId, config.verified_role_id, config.unverified_role_id, config.dm_message, config.require_captcha]);

        config.channel_id = channelId;
        return await showVerificationMenu(interaction, config);
    }

    // Verified role selection menu
    if (customId === 'verification_verified_role') {
        const roles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);
        
        if (roles.size === 0) {
            return await smartReply(interaction, { embeds: [error('No roles found!')] });
        }

        const options = roles.sort((a, b) => b.position - a.position).map(role => 
            new StringSelectMenuOptionBuilder()
                .setLabel(role.name)
                .setValue(role.id)
                .setDescription('Given after verification')
                .setDefault(config.verified_role_id === role.id)
        ).slice(0, 25);

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('verification_verified_role_selected')
            .setPlaceholder('Select verified role')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_verification').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('⬅️')
        );

        return await smartReply(interaction, { 
            embeds: [new EmbedBuilder().setTitle('Select Verified Role').setDescription('Role assigned after successful verification.').setColor('#667eea')],
            components: [row, backRow]
        });
    }

    // Verified role selected
    if (customId === 'verification_verified_role_selected') {
        const roleId = values[0];
        
        await db.query(`
            INSERT INTO verification_config (guildid, enabled, channel_id, verified_role_id, unverified_role_id, dm_message, require_captcha)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (guildid) DO UPDATE SET verified_role_id = $4
        `, [guild.id, config.enabled, config.channel_id, roleId, config.unverified_role_id, config.dm_message, config.require_captcha]);

        config.verified_role_id = roleId;
        return await showVerificationMenu(interaction, config);
    }

    // Unverified role selection menu
    if (customId === 'verification_unverified_role') {
        const roles = guild.roles.cache.filter(r => r.name !== '@everyone' && !r.managed);
        
        if (roles.size === 0) {
            return await smartReply(interaction, { embeds: [error('No roles found!')] });
        }

        const options = roles.sort((a, b) => b.position - a.position).map(role => 
            new StringSelectMenuOptionBuilder()
                .setLabel(role.name)
                .setValue(role.id)
                .setDescription('Given to new members')
                .setDefault(config.unverified_role_id === role.id)
        ).slice(0, 25);

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('verification_unverified_role_selected')
            .setPlaceholder('Select unverified role')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_verification').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('⬅️')
        );

        return await smartReply(interaction, { 
            embeds: [new EmbedBuilder().setTitle('Select Unverified Role').setDescription('Role assigned to new members before verification.').setColor('#667eea')],
            components: [row, backRow]
        });
    }

    // Unverified role selected
    if (customId === 'verification_unverified_role_selected') {
        const roleId = values[0];
        
        await db.query(`
            INSERT INTO verification_config (guildid, enabled, channel_id, verified_role_id, unverified_role_id, dm_message, require_captcha)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (guildid) DO UPDATE SET unverified_role_id = $5
        `, [guild.id, config.enabled, config.channel_id, config.verified_role_id, roleId, config.dm_message, config.require_captcha]);

        config.unverified_role_id = roleId;
        return await showVerificationMenu(interaction, config);
    }
};
