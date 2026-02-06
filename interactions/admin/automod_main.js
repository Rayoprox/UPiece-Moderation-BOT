const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder, StringSelectMenuBuilder } = require('discord.js');
const { safeDefer } = require('../../utils/interactionHelpers.js');

module.exports = async (interaction) => {
    const { customId, guild, client, values } = interaction;

    // When user opens the Automod main menu
    if (customId === 'setup_automod') {
        if (!await safeDefer(interaction, true)) return;
        const embed = new EmbedBuilder()
            .setTitle('🤖 Automod Control Center')
            .setDescription('Choose a module to configure below. Each module has its own rules and bypasses.')
            .addFields(
                { name: '🧷 Anti-Mention', value: 'Protect roles from being pinged.', inline: true },
                { name: '⚡ Anti-Spam', value: 'Control message rate, repeats and emoji spam.', inline: true },
                { name: '🔨 Auto-Punishment', value: 'Warn-based punishments (legacy automod).', inline: true }
            )
            .setFooter({ text: 'Use Back to return to Setup Home' })
            .setColor('#0EA5E9');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('automod_anti_mention').setLabel('Anti-Mention').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('automod_anti_spam').setLabel('Anti-Spam').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('setup_autopunishment').setLabel('Auto-Punishment').setStyle(ButtonStyle.Success)
        );

        const back = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('setup_home').setLabel('Back').setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({ embeds: [embed], components: [row, back] });
        return;
    }

    // Anti-Mention configuration (role select menus)
    if (customId === 'automod_anti_mention') {
        if (!await safeDefer(interaction, true)) return;
        const { embed, components } = await buildAntiMentionView(client.db, guild.id);
        await interaction.editReply({ embeds: [embed], components });
        return;
    }

    if (customId === 'automod_antimention_roles' || customId === 'automod_antimention_bypass') {
        if (!await safeDefer(interaction, true)) return;
        const res = await client.db.query('SELECT antimention_roles, antimention_bypass, antispam FROM automod_protections WHERE guildid = $1', [guild.id]);
        const current = res.rows[0] || {};
        const nextProtected = customId === 'automod_antimention_roles' ? (values.length > 0 ? values : []) : (current.antimention_roles || []);
        const nextBypass = customId === 'automod_antimention_bypass' ? (values.length > 0 ? values : []) : (current.antimention_bypass || []);
        const antispam = current.antispam || {};

        await client.db.query(
            `INSERT INTO automod_protections (guildid, antimention_roles, antimention_bypass, antispam)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (guildid) DO UPDATE SET antimention_roles = $2, antimention_bypass = $3, antispam = $4`,
            [guild.id, nextProtected.length ? nextProtected : null, nextBypass.length ? nextBypass : null, antispam]
        );

        const { embed, components } = await buildAntiMentionView(client.db, guild.id, '✅ Anti-Mention updated.');
        await interaction.editReply({ embeds: [embed], components });
        return;
    }

    // Anti-Spam submenu
    if (customId === 'automod_anti_spam') {
        if (!await safeDefer(interaction, true)) return;
        const { embed, components } = await buildAntiSpamView(client.db, guild.id);
        await interaction.editReply({ embeds: [embed], components });
        return;
    }

    // Anti-Spam type selection
    if (customId === 'automod_antispam_type_select') {
        if (!await safeDefer(interaction, true)) return;
        const type = values[0];
        const { embed, components } = await buildAntiSpamConfigView(client.db, guild.id, type);
        await interaction.editReply({ embeds: [embed], components });
        return;
    }

    // Anti-Spam threshold selection
    if (customId === 'automod_antispam_threshold_select') {
        if (!await safeDefer(interaction, true)) return;
        const [threshold, type] = values[0].split(':');
        const res = await client.db.query('SELECT antimention_roles, antimention_bypass, antispam FROM automod_protections WHERE guildid = $1', [guild.id]);
        const current = res.rows[0] || {};
        let antispam = current.antispam || {};
        antispam[type] = antispam[type] || {};
        antispam[type].threshold = parseInt(threshold, 10);
        
        await client.db.query(
            `INSERT INTO automod_protections (guildid, antimention_roles, antimention_bypass, antispam)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (guildid) DO UPDATE SET antimention_roles = $2, antimention_bypass = $3, antispam = $4`,
            [guild.id, current.antimention_roles || null, current.antimention_bypass || null, antispam]
        );

        const { embed, components } = await buildAntiSpamConfigView(client.db, guild.id, type, '✅ Threshold updated.');
        await interaction.editReply({ embeds: [embed], components });
        return;
    }

    // Anti-Spam bypass roles selection
    if (customId === 'automod_antispam_bypass_select') {
        if (!await safeDefer(interaction, true)) return;
        const type = interaction.message.embeds[0]?.footer?.text?.match(/Type: (\w+)/)?.[1];
        if (!type) return interaction.editReply({ embeds: [{ description: '❌ Error: Could not determine spam type.', color: 0xEF4444 }] });

        const res = await client.db.query('SELECT antimention_roles, antimention_bypass, antispam FROM automod_protections WHERE guildid = $1', [guild.id]);
        const current = res.rows[0] || {};
        let antispam = current.antispam || {};
        antispam[type] = antispam[type] || {};
        antispam[type].bypass = values.length > 0 ? values : [];
        
        await client.db.query(
            `INSERT INTO automod_protections (guildid, antimention_roles, antimention_bypass, antispam)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (guildid) DO UPDATE SET antimention_roles = $2, antimention_bypass = $3, antispam = $4`,
            [guild.id, current.antimention_roles || null, current.antimention_bypass || null, antispam]
        );

        const { embed, components } = await buildAntiSpamConfigView(client.db, guild.id, type, '✅ Bypass roles updated.');
        await interaction.editReply({ embeds: [embed], components });
        return;
    }

    // Anti-Spam delete configuration
    if (customId.startsWith('automod_antispam_delete:')) {
        if (!await safeDefer(interaction, true)) return;
        const type = customId.split(':')[1];
        
        const res = await client.db.query('SELECT antimention_roles, antimention_bypass, antispam FROM automod_protections WHERE guildid = $1', [guild.id]);
        const current = res.rows[0] || {};
        let antispam = current.antispam || {};
        delete antispam[type];
        
        await client.db.query(
            `INSERT INTO automod_protections (guildid, antimention_roles, antimention_bypass, antispam)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (guildid) DO UPDATE SET antimention_roles = $2, antimention_bypass = $3, antispam = $4`,
            [guild.id, current.antimention_roles || null, current.antimention_bypass || null, antispam]
        );

        const { embed, components } = await buildAntiSpamView(client.db, guild.id, '✅ Configuration deleted.');
        await interaction.editReply({ embeds: [embed], components });
        return;
    }

    // Anti-Spam delete configuration
    if (customId.startsWith('automod_antispam_delete:')) {
        if (!await safeDefer(interaction, true)) return;
        const type = customId.split(':')[1];
        
        const res = await client.db.query('SELECT antispam FROM automod_protections WHERE guildid = $1', [guild.id]);
        let antispam = res.rows[0]?.antispam || {};
        delete antispam[type];
        
        await client.db.query(
            `INSERT INTO automod_protections (guildid, antimention_roles, antimention_bypass, antispam)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (guildid) DO UPDATE SET antispam = $4`,
            [guild.id, null, null, antispam]
        );

        const { embed, components } = await buildAntiSpamView(client.db, guild.id, '✅ Configuration deleted.');
        await interaction.editReply({ embeds: [embed], components });
        return;
    }

};

async function buildAntiMentionView(db, guildId, statusText = null) {
    const res = await db.query('SELECT antimention_roles, antimention_bypass FROM automod_protections WHERE guildid = $1', [guildId]);
    const row = res.rows[0] || {};
    const protectedRoles = row.antimention_roles || [];
    const bypassRoles = row.antimention_bypass || [];

    const embed = new EmbedBuilder()
        .setTitle('🧷 Anti-Mention Configuration')
        .setDescription('Select the protected roles and who can bypass the system.')
        .addFields(
            { name: 'Protected Roles', value: protectedRoles.length ? protectedRoles.map(id => `<@&${id}>`).join(' ') : 'None', inline: false },
            { name: 'Bypass Roles', value: bypassRoles.length ? bypassRoles.map(id => `<@&${id}>`).join(' ') : 'None', inline: false }
        )
        .setFooter({ text: statusText || 'Changes apply immediately after selection.' })
        .setColor('#6366F1');

    const protectedSelect = new RoleSelectMenuBuilder()
        .setCustomId('automod_antimention_roles')
        .setPlaceholder('Select protected roles')
        .setMinValues(0)
        .setMaxValues(25);

    const bypassSelect = new RoleSelectMenuBuilder()
        .setCustomId('automod_antimention_bypass')
        .setPlaceholder('Select bypass roles')
        .setMinValues(0)
        .setMaxValues(25);

    const row1 = new ActionRowBuilder().addComponents(protectedSelect);
    const row2 = new ActionRowBuilder().addComponents(bypassSelect);
    const back = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('setup_automod').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary)
    );

    return { embed, components: [row1, row2, back] };
}

async function buildAntiSpamView(db, guildId, statusText = null) {
    const res = await db.query('SELECT antispam FROM automod_protections WHERE guildid = $1', [guildId]);
    const antispam = res.rows[0]?.antispam || {};

    const mpsConfig = antispam.mps || { threshold: 0, bypass: [] };
    const repeatedConfig = antispam.repeated || { threshold: 0, bypass: [] };
    const emojiConfig = antispam.emoji || { threshold: 0, bypass: [] };

    const embed = new EmbedBuilder()
        .setTitle('⚡ Anti-Spam Configuration')
        .setDescription('Select a spam type to configure threshold and bypass roles.')
        .addFields(
            { name: '📨 Messages/sec', value: `Threshold: **${mpsConfig.threshold || 'Not set'}**\nBypass: ${mpsConfig.bypass?.length ? `${mpsConfig.bypass.length} role(s)` : 'None'}`, inline: true },
            { name: '🔁 Repeated Char', value: `Threshold: **${repeatedConfig.threshold || 'Not set'}**\nBypass: ${repeatedConfig.bypass?.length ? `${repeatedConfig.bypass.length} role(s)` : 'None'}`, inline: true },
            { name: '😀 Emoji Spam', value: `Threshold: **${emojiConfig.threshold || 'Not set'}**\nBypass: ${emojiConfig.bypass?.length ? `${emojiConfig.bypass.length} role(s)` : 'None'}`, inline: true }
        )
        .setFooter({ text: statusText || 'Select a type below to configure' })
        .setColor('#F59E0B');

    const typeSelect = new StringSelectMenuBuilder()
        .setCustomId('automod_antispam_type_select')
        .setPlaceholder('Select spam type to configure')
        .addOptions([
            { label: '📨 Messages/sec', value: 'mps', description: 'Configure message rate limiting' },
            { label: '🔁 Repeated Characters', value: 'repeated', description: 'Configure repeated character detection' },
            { label: '😀 Emoji Spam', value: 'emoji', description: 'Configure emoji spam detection' }
        ]);

    const row1 = new ActionRowBuilder().addComponents(typeSelect);
    const back = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('setup_automod').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary));

    return { embed, components: [row1, back] };
}

async function buildAntiSpamConfigView(db, guildId, type, statusText = null) {
    const res = await db.query('SELECT antispam FROM automod_protections WHERE guildid = $1', [guildId]);
    const antispam = res.rows[0]?.antispam || {};
    const config = antispam[type] || { threshold: 0, bypass: [] };

    const typeLabels = {
        mps: { name: '📨 Messages/sec', desc: 'How many messages per second', unit: 'msgs/sec' },
        repeated: { name: '🔁 Repeated Characters', desc: 'Max repeated characters allowed', unit: 'characters' },
        emoji: { name: '😀 Emoji Spam', desc: 'Max emojis per message', unit: 'emojis' }
    };

    const label = typeLabels[type] || typeLabels.mps;

    const embed = new EmbedBuilder()
        .setTitle(`${label.name} Configuration`)
        .setDescription(`Configure ${label.desc.toLowerCase()}.`)
        .addFields(
            { name: 'Current Threshold', value: config.threshold ? `**${config.threshold}** ${label.unit}` : 'Not set', inline: true },
            { name: 'Bypass Roles', value: config.bypass?.length ? config.bypass.map(id => `<@&${id}>`).join(' ') : 'None', inline: true }
        )
        .setFooter({ text: statusText || `Type: ${type} | Select threshold and bypass roles below` })
        .setColor('#F59E0B');

    const thresholdOptions = type === 'mps'
        ? [{ label: '3 msgs/sec', value: `3:${type}` }, { label: '5 msgs/sec', value: `5:${type}` }, { label: '7 msgs/sec', value: `7:${type}` }, { label: '10 msgs/sec', value: `10:${type}` }, { label: '15 msgs/sec', value: `15:${type}` }]
        : type === 'repeated'
        ? [{ label: '5 characters', value: `5:${type}` }, { label: '8 characters', value: `8:${type}` }, { label: '10 characters', value: `10:${type}` }, { label: '15 characters', value: `15:${type}` }, { label: '20 characters', value: `20:${type}` }]
        : [{ label: '5 emojis', value: `5:${type}` }, { label: '10 emojis', value: `10:${type}` }, { label: '15 emojis', value: `15:${type}` }, { label: '20 emojis', value: `20:${type}` }, { label: '30 emojis', value: `30:${type}` }];

    const thresholdSelect = new StringSelectMenuBuilder()
        .setCustomId('automod_antispam_threshold_select')
        .setPlaceholder('Select threshold')
        .addOptions(thresholdOptions);

    const bypassSelect = new RoleSelectMenuBuilder()
        .setCustomId('automod_antispam_bypass_select')
        .setPlaceholder('Select bypass roles')
        .setMinValues(0)
        .setMaxValues(25);

    const row1 = new ActionRowBuilder().addComponents(thresholdSelect);
    const row2 = new ActionRowBuilder().addComponents(bypassSelect);
    const back = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('automod_anti_spam').setLabel('⬅️ Back').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`automod_antispam_delete:${type}`).setLabel('🗑️ Delete').setStyle(ButtonStyle.Danger)
    );

    return { embed, components: [row1, row2, back] };
}
